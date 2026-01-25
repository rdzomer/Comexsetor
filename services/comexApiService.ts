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
// ✅ API correta (Swagger / produção): POST https://api-comexstat.mdic.gov.br/general
// ✅ Querystring tipicamente só para language (opcional). Aqui fixamos language=pt para consistência.
// 🚫 Não usar http:// (Mixed Content) e 🚫 não usar host sem hífen (ERR_NAME_NOT_RESOLVED).
const GENERAL_ENDPOINT = "https://api-comexstat.mdic.gov.br/general?language=pt";

// Endpoint de atualização mudou na API nova. Mantemos múltiplas tentativas.
const LAST_UPDATE_ENDPOINTS = [
  // API nova
  "https://api-comexstat.mdic.gov.br/general/dates/updated",

  // API legada / variações (mantido como fallback)
  "https://api.comexstat.mdic.gov.br/general/lastUpdate",
  "https://api.comexstat.mdic.gov.br/general/lastupdate",
  "https://api.comexstat.mdic.gov.br/general/last-update",
];

// ===== CGIM - limite de volume =====
// Ajustes “empíricos” (mínimos) para reduzir bloqueios:
// - chunk menor reduz payload por request
// - concorrência baixa reduz tempestade de requests
const CGIM_MAX_NCMS_PER_REQUEST = 60; // comece com 40–80; 60 costuma ser bom
const CGIM_MAX_CONCURRENCY = 3;       // 2–4 conforme sua meta (aqui: 3)
const DEFAULT_TIMEOUT_MS = 45_000;

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

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init ?? {}), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * 🔧 AÇÃO MÍNIMA (auditoria):
 * Corrige payload legado quando alguém usa "noNcmpt" como filtro (errado) passando código NCM.
 * - noNcmpt é campo textual (descrição), não filtro de código.
 * - para código NCM o id correto no legado é "coNcm".
 *
 * Isso evita 400 quando, por algum caminho, ainda sai:
 *   filterList: [{id:"noNcmpt"}]
 *   filterArray: [{idInput:"noNcmpt", item:["87087090"]}]
 */
function sanitizeLegacyNcmFilterIds(p: any) {
  if (!p || typeof p !== "object") return p;

  const fl = Array.isArray(p.filterList) ? p.filterList : null;
  const fa = Array.isArray(p.filterArray) ? p.filterArray : null;
  if (!fl || !fa) return p;

  // detecta se "noNcmpt" está sendo usado com itens que parecem NCM (8 dígitos)
  const hasNoNcmptAsFilter = fl.some((x: any) => x?.id === "noNcmpt") || fa.some((x: any) => x?.idInput === "noNcmpt");
  if (!hasNoNcmptAsFilter) return p;

  const looksLikeNcmCode = (v: any) => {
    const d = normalizeNcmDigits(v);
    return d.length === 8;
  };

  const arrayHasNcmCodes = fa.some((x: any) => Array.isArray(x?.item) && x.item.some(looksLikeNcmCode));
  if (!arrayHasNcmCodes) return p;

  // troca ids errados para o correto do legado
  p.filterList = fl.map((x: any) => (x?.id === "noNcmpt" ? { ...x, id: "coNcm" } : x));
  p.filterArray = fa.map((x: any) => (x?.idInput === "noNcmpt" ? { ...x, idInput: "coNcm" } : x));
  return p;
}

/**
 * ✅ Converte payload legado (do App antigo) para o body novo do /general (Swagger).
 * Cobre o que é usado hoje: NCM e "country".
 */
function legacyToNewGeneralBody(p: any) {
  const flow = Number(p?.typeForm) === 1 ? "export" : "import";

  const yearStart = String(p?.yearStart ?? "");
  const yearEnd = String(p?.yearEnd ?? "");
  const monthStart = String(p?.monthStart ?? "01").padStart(2, "0");
  const monthEnd = String(p?.monthEnd ?? "12").padStart(2, "0");

  const period = {
    from: `${yearStart}-${monthStart}`,
    to: `${yearEnd}-${monthEnd}`,
  };

  // metrics
  const metrics: string[] = [];
  for (const k of ["metricFOB", "metricKG", "metricStatistic", "metricFreight", "metricInsurance", "metricCIF"]) {
    if (p?.[k] === true) metrics.push(k);
  }

  // filters: NCM (aceita legado "coNcm" e também corrige "noNcmpt" se vier errado)
  const filters: Array<{ filter: string; values: any[] }> = [];
  const fa = Array.isArray(p?.filterArray) ? p.filterArray : [];

  for (const f of fa) {
    const id = f?.idInput;

    // ✅ id correto legado para código NCM
    if (id === "coNcm") {
      filters.push({ filter: "ncm", values: Array.isArray(f.item) ? f.item : [] });
      continue;
    }

    // 🔧 compat: alguns caminhos antigos mandam "noNcmpt" errado com código
    if (id === "noNcmpt") {
      filters.push({ filter: "ncm", values: Array.isArray(f.item) ? f.item : [] });
      continue;
    }
  }

  // details: mapear seus ids legados -> names novos
  const details: string[] = [];
  const dd = Array.isArray(p?.detailDatabase) ? p.detailDatabase : [];
  for (const d of dd) {
    const id = d?.id;
    if (id === "noNcmpt" && !details.includes("ncm")) details.push("ncm");
    if (
      (id === "noPais" ||
        id === "noPaisOrigem" ||
        id === "noPaisDestino" ||
        id === "coPais" ||
        id === "coPaisOrigem" ||
        id === "coPaisDestino") &&
      !details.includes("country")
    ) {
      details.push("country");
    }
  }

  return {
    flow,
    monthDetail: Boolean(p?.monthDetail),
    period,
    filters,
    details: details.length ? details : ["ncm"],
    metrics: metrics.length ? metrics : ["metricFOB", "metricKG"],
  };
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

  const tryArrayShape = (root: any): any[] => {
    if (!Array.isArray(root)) return [];

    const a = root?.[0]?.[0];
    if (Array.isArray(a)) return a;

    const b = root?.[0];
    if (Array.isArray(b) && (b.length === 0 || typeof b[0] === "object")) return b;

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

// ====== ✅ NOVO CORE: /general via POST + body (Swagger) ======
async function comexGeneralRequest(payload: any, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any[]> {
  try {
    const url = GENERAL_ENDPOINT;

    // 🔧 AÇÃO MÍNIMA: garantir que, se vier "noNcmpt" como filtro legado, vira "coNcm"
    const sanitized = sanitizeLegacyNcmFilterIds(payload);

    // ✅ Se já vier no formato novo, usa direto
    const isNewShape =
      sanitized &&
      typeof sanitized.flow === "string" &&
      sanitized.period &&
      Array.isArray(sanitized.metrics);

    const body = isNewShape ? sanitized : legacyToNewGeneralBody(sanitized);

    const res = await fetchWithTimeout(url, timeoutMs, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[comexApiService] /general falhou:", res.status, res.statusText, txt);
      return [];
    }

    const json = await res.json();
    return extractRows(json);
  } catch (e) {
    console.warn("[comexApiService] Falha ao consultar /general (POST). Retornando lista vazia.", e);
    return [];
  }
}

function mapFiltersToComex(filterList: any[], filterArray: any[], detailDatabase: any[], filters: ApiFilter[]) {
  for (const f of filters || []) {
    if (f.filter === "ncm") {
      const items = (f.values || []).map(normalizeNcmLoose).filter(Boolean);
      filterList.push({ id: "coNcm" });
      filterArray.push({ item: items, idInput: "coNcm" });
      // detailDatabase só se você realmente precisa detalhar/agrupador; senão pode ficar vazio
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
      const data = json?.data ?? json;

      if (data && Number.isFinite(data.ano) && Number.isFinite(data.mes)) {
        return { year: Number(data.ano), month: Number(data.mes) };
      }

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

  // ✅ Prioriza host novo com hífen (HTTPS).
  // Mantém fallback legado (HTTPS) se necessário.
  const candidates = [
    `https://api-comexstat.mdic.gov.br/tables/ncm/${n}`,
    `https://api-comexstat.mdic.gov.br/tables/ncm?code=${n}`,
    `https://api-comexstat.mdic.gov.br/tables/ncm?noNcm=${n}`,

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
    `https://api-comexstat.mdic.gov.br/tables/ncm/${n}`,
    `https://api-comexstat.mdic.gov.br/tables/ncm?code=${n}`,
    `https://api-comexstat.mdic.gov.br/tables/ncm?noNcm=${n}`,

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
      filterList: [{ id: "coNcm" }],
      filterArray: [{ item: [n], idInput: "coNcm" }],
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
    filterList: [{ id: "coNcm" }],
    filterArray: [{ item: [ncm8], idInput: "coNcm" }],
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

  try {
    const resRows = await comexGeneralRequest(payload);
    if (!resRows.length) return { fob: 0, kg: 0 };
    const r = resRows[0];
    return {
      fob: Number(r?.metricFOB ?? r?.vlFob ?? r?.vl_fob ?? r?.fob ?? 0) || 0,
      kg: Number(r?.metricKG ?? r?.kgLiquido ?? r?.kg_liquido ?? r?.kg ?? 0) || 0,
    };
  } catch (e) {
    console.warn("[fetchComexYearByNcm] Falha ao consultar ComexStat. Retornando 0.", e);
    return { fob: 0, kg: 0 };
  }
}

/**
 * ✅ NOVO (CGIM em lote): busca FOB/KG para UMA LISTA de NCMs
 * Agora com chunk + limite de concorrência para reduzir bloqueios.
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

  const flow: TradeFlow =
    args.flow === "export" ? "exp" : args.flow === "import" ? "imp" : (args.flow as TradeFlow);

  // ---- chunk helper ----
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // ---- execução com limite de concorrência ----
  const chunks = chunk(ncms8, CGIM_MAX_NCMS_PER_REQUEST);

  const results: NcmYearRow[] = [];
  let idx = 0;

  const worker = async () => {
    while (idx < chunks.length) {
      const myIdx = idx++;
      const thisChunk = chunks[myIdx];

      const payload = {
        yearStart: String(year),
        yearEnd: String(year),
        typeForm: toApiTypeForm(flow),
        typeOrder: 1,
        filterList: [{ id: "coNcm" }],
        filterArray: [{ item: thisChunk, idInput: "coNcm" }],
        detailDatabase: [{ id: "noNcmpt", text: "" }], // força retorno por NCM
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

      for (const r of rows ?? []) {
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

        results.push({ ncm, fob, kg });
      }
    }
  };

  const concurrency = Math.max(1, Math.min(CGIM_MAX_CONCURRENCY, chunks.length));
  const workers = Array.from({ length: concurrency }, () => worker());

  await Promise.allSettled(workers);

  return results;
}