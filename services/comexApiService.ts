// services/comexApiService.ts
// ✅ CONTRATO LEGADO do App.tsx + ✅ export extra para o CGIM (fetchComexYearByNcm)
// Não remova exports daqui enquanto App.tsx depender deles.

import type { NcmYearValue } from "../utils/cgimTypes";

export type TradeFlowUi = "import" | "export"; // usado pelo App
export type TradeFlow = "imp" | "exp"; // usado pelo CGIM

// ✅ (NOVO) Linha anual por NCM (para retorno em lote do CGIM)
export type NcmYearRow = { ncm: string; fob: number; kg: number };

export interface LastUpdateData {
  year: number;
  month: number;
}

export interface Period {
  from: string; // "YYYY-MM"
  to: string;   // "YYYY-MM"
}

export interface ApiFilter {
  filter: "ncm" | string;
  values: string[];
}

export type ComexStatRecord = any;
export type MonthlyComexStatRecord = any;

export interface CountryDataRecord {
  country: string;
  metricFOB: number;
  metricKG: number;
  representatividadeFOB?: number;
  representatividadeKG?: number;
}

// ===== CONFIG =====
// ⚠️ IMPORTANTÍSSIMO:
// A API nova usa o host com hífen: api-comexstat.mdic.gov.br
// Mantemos também os hosts legados como fallback para não quebrar nada.
// Encontre as BASE_URLS e substitua por estas:
const BASE_URLS = [
  "/api-proxy/general?filter=",
  "https://api-comexstat.mdic.gov.br/general?filter=",
  "http://api-comexstat.mdic.gov.br/general?filter="
];

const LAST_UPDATE_ENDPOINTS = [
  "/api-proxy/general/dates/updated",
  "https://api-comexstat.mdic.gov.br/general/dates/updated",
  "https://api-comexstat.mdic.gov.br/general/lastUpdate"
];

const LAST_UPDATE_ENDPOINTS = [
  // 1. Tenta pelo Proxy do Netlify
  "/api-proxy/general/dates/updated",

  // 2. Fallbacks
  "https://api-comexstat.mdic.gov.br/general/dates/updated",
  "https://api.comexstat.mdic.gov.br/general/lastUpdate",
  "https://api.comexstat.mdic.gov.br/general/lastupdate",
  "https://api.comexstat.mdic.gov.br/general/last-update",
];

// Endpoint de atualização mudou na API nova. Mantemos múltiplas tentativas.
const LAST_UPDATE_ENDPOINTS = [
  // API nova
  "https://api-comexstat.mdic.gov.br/general/dates/updated",

  // API legada / variações
  "https://api.comexstat.mdic.gov.br/general/lastUpdate",
  "https://api.comexstat.mdic.gov.br/general/lastupdate",
  "https://api.comexstat.mdic.gov.br/general/last-update",
];

// ===== HELPERS =====

function toApiTypeFormFromUi(flow: TradeFlowUi): number {
  return flow === "export" ? 1 : 2;
}

function toApiTypeForm(flow: TradeFlow): number {
  return flow === "exp" ? 1 : 2;
}

function parseYearMonth(s: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

function periodToYears(period: Period): { yearStart: number; yearEnd: number; monthStart: string; monthEnd: string } {
  const from = parseYearMonth(period.from);
  const to = parseYearMonth(period.to);
  const now = new Date();
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 };

  const f = from ?? fallback;
  const t = to ?? fallback;

  return {
    yearStart: f.year,
    yearEnd: t.year,
    monthStart: String(f.month).padStart(2, "0"),
    monthEnd: String(t.month).padStart(2, "0"),
  };
}

function buildMetricsFlags(metrics: string[]) {
  const set = new Set(metrics || []);
  return {
    metricFOB: set.has("metricFOB"),
    metricKG: set.has("metricKG"),
    metricStatistic: set.has("metricStatistic"),
    metricCIF: set.has("metricCIF"),
    metricFreight: set.has("metricFreight"),
    metricInsurance: set.has("metricInsurance"),
  };
}

function normalizeNcmDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

// ✅ Para CGIM: NCM canônica de 8 dígitos ou null
export function normalizeNcmTo8(raw: unknown): string | null {
  const digits = normalizeNcmDigits(raw);
  if (digits.length !== 8) return null;
  return digits;
}

// Para App: não forçamos 8, pois ele pode aceitar hierarquia; mas em geral o usuário usa 8
function normalizeNcmLoose(raw: unknown): string {
  return normalizeNcmDigits(raw);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Extrai as linhas do retorno do Comex Stat.
 *
 * A API antiga (legada) retornava um array "cru" no formato: [[rows], meta...]
 * A API nova (api-comexstat) retorna um envelope: { data: { list: [...] }, success: true, ... }
 *   e/ou algumas variações: { data: [[rows], ...], ... }
 *
 * Se este parser falhar, o CGIM zera tudo (porque acha que "não veio nada").
 */
function extractRows(json: any): any[] {
  // ✅ Formato comum na API nova: { data: { list: [...] } }
  const list =
    json?.data?.list ??
    json?.Data?.list ??
    json?.result?.list ??
    json?.resultado?.list;

  // ✅ (AJUSTE) Às vezes o "list" vem como array legado dentro (list[0][0])
  if (Array.isArray(list)) {
    // list pode ser: [ [rows], meta ]  OU  rows direto
    const maybe = list?.[0]?.[0];
    if (Array.isArray(maybe)) return maybe;

    const maybe2 = list?.[0];
    if (Array.isArray(maybe2) && (maybe2.length === 0 || typeof maybe2[0] === "object")) return maybe2;

    if (list.length === 0) return list;
    if (list.length > 0 && typeof list[0] === "object" && !Array.isArray(list[0])) return list;
  }

  // --- Helper para navegar em formatos possíveis ---
  const tryArrayShape = (root: any): any[] => {
    if (!Array.isArray(root)) return [];

    // formato mais comum nos serviços legados: root[0][0] = rows
    const a = root?.[0]?.[0];
    if (Array.isArray(a)) return a;

    // às vezes vem root[0] = rows
    const b = root?.[0];
    if (Array.isArray(b) && (b.length === 0 || typeof b[0] === "object")) return b;

    // às vezes já vem array de objetos direto
    if (root.length === 0) return root;
    if (root.length > 0 && typeof root[0] === "object" && !Array.isArray(root[0])) return root;

    return [];
  };

  // 1) formato antigo (array raiz)
  const fromArrayRoot = tryArrayShape(json);
  if (fromArrayRoot.length) return fromArrayRoot;

  // 2) formato novo (envelope com data como array)
  const data = json?.data ?? json?.Data ?? json?.result ?? json?.resultado;
  const fromData = tryArrayShape(data);
  if (fromData.length) return fromData;

  // ✅ (AJUSTE) alguns endpoints aninham data.data
  const data2 = data?.data ?? data?.Data ?? data?.result ?? data?.resultado;
  const fromData2 = tryArrayShape(data2);
  if (fromData2.length) return fromData2;

  // 3) alguns endpoints podem aninhar mais um nível
  const deep = json?.data?.data ?? json?.data?.rows ?? json?.rows;
  const fromDeep = tryArrayShape(deep);
  if (fromDeep.length) return fromDeep;

  // ✅ (AJUSTE) variações: data.list dentro de data.data
  const deepList = json?.data?.data?.list ?? json?.data?.result?.list ?? json?.data?.resultado?.list;
  const fromDeepList = tryArrayShape(deepList);
  if (fromDeepList.length) return fromDeepList;

  return [];
}

function coerceNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseGeneralResponseToValue(json: any): NcmYearValue {
  const rows = extractRows(json);
  if (!rows.length) return { fob: 0, kg: 0 };
  const row = rows[0];

  // ✅ API nova muitas vezes usa metricFOB/metricKG
  const fob = coerceNumber(
    row?.metricFOB ??
      row?.vlFob ??
      row?.vl_fob ??
      row?.fob ??
      row?.valorFOB ??
      row?.vlFOB
  );

  const kg = coerceNumber(
    row?.metricKG ??
      row?.kgLiquido ??
      row?.kg_liquido ??
      row?.kg ??
      row?.pesoLiquido ??
      row?.kgLiqu
  );

  return { fob, kg };
}

async function comexGeneralRequest(payload: any, timeoutMs = 45_000): Promise<any[]> {
  const filter = encodeURIComponent(JSON.stringify(payload));
  let lastErr: any = null;

  for (const base of BASE_URLS) {
    const url = `${base}${filter}`;
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) {
        lastErr = new Error(`ComexStat HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      return extractRows(json);
    } catch (e) {
      lastErr = e;
    }
  }

  console.warn("[comexApiService] Falha ao consultar ComexStat. Retornando lista vazia.", lastErr);
  return [];
}

function mapFiltersToComex(filterList: any[], filterArray: any[], detailDatabase: any[], filters: ApiFilter[]) {
  for (const f of filters || []) {
    if (f.filter === "ncm") {
      const items = (f.values || []).map(normalizeNcmLoose).filter(Boolean);
      filterList.push({ id: "noNcmpt" });
      filterArray.push({ item: items, idInput: "noNcmpt" });
      detailDatabase.push({ id: "noNcmpt", text: "" });
    }
  }
}

// ===== EXPORTS DO APP =====

export async function fetchLastUpdateData(): Promise<LastUpdateData> {
  for (const url of LAST_UPDATE_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(url, 15_000);
      if (!res.ok) continue;
      const json = await res.json();
      if (json && Number.isFinite(json.year) && Number.isFinite(json.month)) {
        return { year: Number(json.year), month: Number(json.month) };
      }
      // API nova costuma vir envelopada em { data, success, ... }
      const data = json?.data ?? json;

      if (data && Number.isFinite(data.ano) && Number.isFinite(data.mes)) {
        return { year: Number(data.ano), month: Number(data.mes) };
      }

      // fallback: se vier uma data (updatedAt / updated_at), converte
      const updatedAt = data?.updatedAt ?? data?.updated_at ?? data?.dataAtualizacao ?? data?.lastUpdate;
      if (typeof updatedAt === "string" && updatedAt) {
        const d = new Date(updatedAt);
        if (!Number.isNaN(d.getTime())) {
          return { year: d.getFullYear(), month: d.getMonth() + 1 };
        }
      }
    } catch {
      // segue
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export async function fetchNcmDescription(ncm: string): Promise<string> {
  const n = normalizeNcmLoose(ncm);
  if (!n) return "";

  const candidates = [
    `https://api.comexstat.mdic.gov.br/tables/ncm/${n}`,
    `https://api.comexstat.mdic.gov.br/tables/ncm?code=${n}`,
    `https://api.comexstat.mdic.gov.br/tables/ncm?noNcm=${n}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, 15_000);
      if (!res.ok) continue;
      const json = await res.json();
      const desc =
        json?.description ??
        json?.descricao ??
        json?.noNcmpt ??
        json?.noNcm ??
        json?.data?.description ??
        json?.data?.descricao;
      if (typeof desc === "string") return desc;
    } catch {
      // segue
    }
  }
  return "";
}

export async function fetchNcmUnit(ncm: string): Promise<string> {
  const n = normalizeNcmLoose(ncm);
  if (!n) return "";

  const candidates = [
    `https://api.comexstat.mdic.gov.br/tables/ncm/${n}`,
    `https://api.comexstat.mdic.gov.br/tables/ncm?code=${n}`,
    `https://api.comexstat.mdic.gov.br/tables/ncm?noNcm=${n}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, 15_000);
      if (!res.ok) continue;
      const json = await res.json();
      const unit =
        json?.unit ??
        json?.unidade ??
        json?.noUnid ??
        json?.data?.unit ??
        json?.data?.unidade ??
        json?.data?.noUnid;
      if (typeof unit === "string") return unit;
    } catch {
      // segue
    }
  }
  return "";
}

export async function fetchComexData(
  flow: TradeFlowUi,
  period: Period,
  filters: ApiFilter[],
  metrics: string[],
  groupBy: string[] = []
): Promise<ComexStatRecord[]> {
  const { yearStart, yearEnd, monthStart, monthEnd } = periodToYears(period);
  const metricFlags = buildMetricsFlags(metrics);

  const detailDatabase: any[] = [];
  const filterList: any[] = [];
  const filterArray: any[] = [];

  mapFiltersToComex(filterList, filterArray, detailDatabase, filters);

  const wantsNcmDetail = (groupBy || []).includes("ncm");
  if (wantsNcmDetail) {
    if (!detailDatabase.some((d) => d.id === "noNcmpt")) {
      detailDatabase.push({ id: "noNcmpt", text: "" });
    }
  }

  const payload = {
    yearStart: String(yearStart),
    yearEnd: String(yearEnd),
    typeForm: toApiTypeFormFromUi(flow),
    typeOrder: 1,
    filterList,
    filterArray,
    detailDatabase,
    monthDetail: false,
    ...metricFlags,
    monthStart,
    monthEnd,
    formQueue: "general",
    langDefault: "pt",
  };

  return await comexGeneralRequest(payload);
}

export async function fetchMonthlyComexData(
  flow: TradeFlowUi,
  period: Period,
  filters: ApiFilter[],
  metrics: string[]
): Promise<MonthlyComexStatRecord[]> {
  const { yearStart, yearEnd, monthStart, monthEnd } = periodToYears(period);
  const metricFlags = buildMetricsFlags(metrics);

  const detailDatabase: any[] = [];
  const filterList: any[] = [];
  const filterArray: any[] = [];

  mapFiltersToComex(filterList, filterArray, detailDatabase, filters);

  const payload = {
    yearStart: String(yearStart),
    yearEnd: String(yearEnd),
    typeForm: toApiTypeFormFromUi(flow),
    typeOrder: 1,
    filterList,
    filterArray,
    detailDatabase,
    monthDetail: true,
    ...metricFlags,
    monthStart,
    monthEnd,
    formQueue: "general",
    langDefault: "pt",
  };

  return await comexGeneralRequest(payload);
}

export async function fetchCountryData(
  ncm: string,
  flow: TradeFlowUi,
  year: number
): Promise<CountryDataRecord[]> {
  const n = normalizeNcmLoose(ncm);
  if (!n || !Number.isFinite(year)) return [];

  const countryDetailIds = ["noPais", "noPaisOrigem", "noPaisDestino", "coPais", "coPaisOrigem", "coPaisDestino"];

  for (const countryId of countryDetailIds) {
    const payload = {
      yearStart: String(year),
      yearEnd: String(year),
      typeForm: toApiTypeFormFromUi(flow),
      typeOrder: 1,
      filterList: [{ id: "noNcmpt" }],
      filterArray: [{ item: [n], idInput: "noNcmpt" }],
      detailDatabase: [{ id: countryId, text: "" }],
      monthDetail: false,
      metricFOB: true,
      metricKG: true,
      metricStatistic: false,
      monthStart: "01",
      monthEnd: "12",
      formQueue: "general",
      langDefault: "pt",
    };

    const rows = await comexGeneralRequest(payload);
    if (rows.length === 0) continue;

    const totalFOB =
      rows.reduce((acc: number, r: any) => acc + Number(r?.metricFOB ?? r?.vlFob ?? r?.vl_fob ?? r?.fob ?? 0), 0) || 0;
    const totalKG =
      rows.reduce((acc: number, r: any) => acc + Number(r?.metricKG ?? r?.kgLiquido ?? r?.kg_liquido ?? r?.kg ?? 0), 0) || 0;

    const out: CountryDataRecord[] = rows
      .map((r: any) => {
        const fob = Number(r?.metricFOB ?? r?.vlFob ?? r?.vl_fob ?? r?.fob ?? 0) || 0;
        const kg = Number(r?.metricKG ?? r?.kgLiquido ?? r?.kg_liquido ?? r?.kg ?? 0) || 0;

        const countryName =
          String(r?.noPais ?? r?.no_pais ?? r?.pais ?? r?.country ?? r?.noPaispt ?? r?.noPaisEn ?? "").trim() ||
          String(r?.coPais ?? r?.co_pais ?? "").trim() ||
          "—";

        return {
          country: countryName,
          metricFOB: fob,
          metricKG: kg,
          representatividadeFOB: totalFOB > 0 ? (fob / totalFOB) * 100 : 0,
          representatividadeKG: totalKG > 0 ? (kg / totalKG) * 100 : 0,
        };
      })
      .sort((a, b) => (b.metricFOB || 0) - (a.metricFOB || 0));

    return out;
  }

  return [];
}

// ===== EXPORT EXTRA PARA O CGIM =====

/**
 * ✅ Export que o CGIM precisa (cgimBasketComexService.ts):
 * Busca FOB/KG de uma NCM (8 dígitos) em um ano.
 */
export async function fetchComexYearByNcm(args: {
  flow: TradeFlow; // "imp" | "exp"
  ncm: string;     // 8 dígitos
  year: number;
}): Promise<NcmYearValue> {
  const ncm8 = normalizeNcmTo8(args.ncm);
  if (!ncm8 || !Number.isFinite(args.year)) return { fob: 0, kg: 0 };

  const payload = {
    yearStart: String(args.year),
    yearEnd: String(args.year),
    typeForm: toApiTypeForm(args.flow),
    typeOrder: 1,
    filterList: [{ id: "noNcmpt" }],
    filterArray: [{ item: [ncm8], idInput: "noNcmpt" }],
    detailDatabase: [{ id: "noNcmpt", text: "" }],
    monthDetail: false,
    metricFOB: true,
    metricKG: true,
    metricStatistic: false,
    monthStart: "01",
    monthEnd: "12",
    formQueue: "general",
    langDefault: "pt",
  };

  const filter = encodeURIComponent(JSON.stringify(payload));

  let lastErr: any = null;
  for (const base of BASE_URLS) {
    try {
      const res = await fetchWithTimeout(`${base}${filter}`, 45_000);
      if (!res.ok) {
        lastErr = new Error(`ComexStat HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      return parseGeneralResponseToValue(json);
    } catch (e) {
      lastErr = e;
    }
  }

  console.warn("[fetchComexYearByNcm] Falha ao consultar ComexStat. Retornando 0.", lastErr);
  return { fob: 0, kg: 0 };
}

/**
 * ✅ NOVO (CGIM em lote): busca FOB/KG para UMA LISTA de NCMs em UMA chamada por lote.
 *
 * Por que isso existe?
 * - No CGIM, consultar NCM por NCM (200+ chamadas) costuma estourar timeout / rate limit.
 * - O ComexStat aceita enviar várias NCMs no mesmo payload (filterArray.item = [...]).
 *
 * Retorna uma linha por NCM encontrada. Quem chamar deve completar faltantes com 0.
 */
export async function fetchComexYearByNcmList(args: {
  flow: TradeFlow | TradeFlowUi; // aceita "imp|exp" ou "import|export"
  year: number;
  ncms: string[];
}): Promise<NcmYearRow[]> {
  const year = Number(args.year);

  const ncms8 = (args.ncms ?? [])
    .map((n) => normalizeNcmTo8(n))
    .filter((x): x is string => Boolean(x));

  if (!Number.isFinite(year) || !ncms8.length) return [];

  // normaliza fluxo ("export" -> "exp")
  const flow: TradeFlow =
    args.flow === "export" ? "exp" : args.flow === "import" ? "imp" : (args.flow as TradeFlow);

  const payload = {
    yearStart: String(year),
    yearEnd: String(year),
    typeForm: toApiTypeForm(flow),
    typeOrder: 1,
    filterList: [{ id: "noNcmpt" }],
    filterArray: [{ item: ncms8, idInput: "noNcmpt" }],
    // ✅ força o retorno por NCM
    detailDatabase: [{ id: "noNcmpt", text: "" }],
    monthDetail: false,
    metricFOB: true,
    metricKG: true,
    metricStatistic: false,
    monthStart: "01",
    monthEnd: "12",
    formQueue: "general",
    langDefault: "pt",
  };

  // ✅ Reusa o pipeline resiliente (BASE_URLS + timeout) do seu próprio serviço
  const rows = await comexGeneralRequest(payload);

  const out: NcmYearRow[] = [];
  for (const r of rows ?? []) {
    // ✅ Na API nova, o NCM pode vir em details.* ou em campos diretos
    const rawNcm =
      r?.noNcmpt ??
      r?.noNcm ??
      r?.coNcm ??
      r?.co_ncm ??
      r?.ncm ??
      r?.details?.noNcmpt ??
      r?.details?.noNcm ??
      r?.details?.coNcm ??
      r?.details?.co_ncm ??
      r?.details?.ncm;

    const ncm = normalizeNcmTo8(rawNcm);
    if (!ncm) continue;

    const fob = Number(r?.metricFOB ?? r?.vlFob ?? r?.vl_fob ?? r?.fob ?? 0) || 0;
    const kg = Number(r?.metricKG ?? r?.kgLiquido ?? r?.kg_liquido ?? r?.kg ?? 0) || 0;

    out.push({ ncm, fob, kg });
  }

  return out;
}
