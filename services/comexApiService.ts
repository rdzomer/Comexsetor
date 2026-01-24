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
  to: string; // "YYYY-MM"
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
const PROD = import.meta.env.PROD;

// Em produção (Netlify): o browser chama o nosso próprio domínio (/api/comex/*),
// e uma Netlify Function faz o proxy para a API do ComexStat.
// Em desenvolvimento (local): mantemos chamada direta para continuar funcionando no npm run dev.
const BASE_URLS = PROD
  ? [
      // ✅ Em produção: SOMENTE via proxy Netlify (evita 451/CORS/Mixed Content no browser)
      "/api/comex/general?filter=",
    ]
  : [
      // ✅ Em desenvolvimento local: chamadas diretas continuam funcionando no npm run dev
      "https://api-comexstat.mdic.gov.br/general?filter=",
      "http://api-comexstat.mdic.gov.br/general?filter=",
      "https://api.comexstat.mdic.gov.br/general?filter=",
    ];

// Endpoint de atualização mudou na API nova. Mantemos múltiplas tentativas.
const LAST_UPDATE_ENDPOINTS = PROD
  ? [
      // ✅ Em produção: SOMENTE via proxy Netlify
      "/api/comex/general/dates/updated",
    ]
  : [
      // ✅ API nova (local)
      "https://api-comexstat.mdic.gov.br/general/dates/updated",

      // ✅ API legada / variações
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

function periodToYM(period: Period): { yearStart: number; monthStart: number; yearEnd: number; monthEnd: number } {
  const f = parseYearMonth(period.from);
  const t = parseYearMonth(period.to);
  if (!f || !t) {
    // fallback defensivo
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return { yearStart: year, monthStart: 1, yearEnd: year, monthEnd: month };
  }
  return { yearStart: f.year, monthStart: f.month, yearEnd: t.year, monthEnd: t.month };
}

function normalizeNcmLoose(ncm: string): string {
  const only = String(ncm || "").replace(/\D/g, "");
  if (only.length === 0) return "";
  // não força 8; mantém como vem (muitas telas usam 6/8)
  return only;
}

function fetchWithTimeout(url: string, ms = 20_000, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...(init || {}), signal: controller.signal }).finally(() => clearTimeout(id));
}

async function tryFetchJson(url: string, ms = 25_000): Promise<any> {
  const res = await fetchWithTimeout(url, ms);
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json") || ct.includes("text/json");
  const text = await res.text();
  if (!res.ok) {
    // tenta extrair msg
    let msg = text;
    try {
      if (isJson) {
        const j = JSON.parse(text);
        msg = j?.message || j?.error || text;
      }
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status} - ${msg}`);
  }
  if (isJson) {
    try {
      return JSON.parse(text);
    } catch {
      // fallback para retorno não-JSON
      return text;
    }
  }
  // às vezes a API devolve JSON com content-type errado
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function safeNumber(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// ===== API CALLS =====

export async function fetchLastUpdate(): Promise<LastUpdateData> {
  for (const url of LAST_UPDATE_ENDPOINTS) {
    try {
      const json = await tryFetchJson(url, 20_000);

      // Formatos possíveis:
      // - API nova: { year, month } OU { data: { year, month } }
      // - API legada: { lastUpdate: "YYYY-MM" } etc.
      const directYear = Number(json?.year ?? json?.data?.year);
      const directMonth = Number(json?.month ?? json?.data?.month);
      if (Number.isFinite(directYear) && Number.isFinite(directMonth)) {
        return { year: directYear, month: directMonth };
      }

      const s =
        json?.lastUpdate ??
        json?.lastupdate ??
        json?.last_update ??
        json?.data?.lastUpdate ??
        json?.data?.lastupdate ??
        json?.data?.last_update;

      if (typeof s === "string") {
        const ym = parseYearMonth(s);
        if (ym) return { year: ym.year, month: ym.month };
      }

      // tentativa de achar no payload
      const maybe = json?.data;
      if (typeof maybe === "string") {
        const ym = parseYearMonth(maybe);
        if (ym) return { year: ym.year, month: ym.month };
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

  const candidates = PROD
    ? [
        // ✅ Em produção: via proxy Netlify (evita 451/CORS)
        `/api/comex/tables/ncm/${n}`,
        `/api/comex/tables/ncm?code=${n}`,
        `/api/comex/tables/ncm?noNcm=${n}`,
      ]
    : [
        // ✅ Em desenvolvimento: direto (funciona no npm run dev)
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

  const candidates = PROD
    ? [
        // ✅ Em produção: via proxy Netlify (evita 451/CORS)
        `/api/comex/tables/ncm/${n}`,
        `/api/comex/tables/ncm?code=${n}`,
        `/api/comex/tables/ncm?noNcm=${n}`,
      ]
    : [
        // ✅ Em desenvolvimento: direto (funciona no npm run dev)
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
        json?.noUnit ??
        json?.data?.unit ??
        json?.data?.unidade ??
        json?.data?.noUnit;
      if (typeof unit === "string") return unit;
    } catch {
      // segue
    }
  }
  return "";
}

// ===============================
// ✅ Função base: chama /general?filter=...
// ===============================
async function comexGeneralRequest(filterObj: any): Promise<any[]> {
  const filter = encodeURIComponent(JSON.stringify(filterObj));
  let lastErr: any = null;

  for (const base of BASE_URLS) {
    const url = `${base}${filter}`;
    try {
      const json = await tryFetchJson(url, 35_000);
      // API costuma devolver { data: [...] } ou direto [...]
      const data = Array.isArray(json) ? json : json?.data;
      if (Array.isArray(data)) return data;
      // fallback: se veio algo inesperado
      return [];
    } catch (err: any) {
      lastErr = err;
      // tenta próximo base
    }
  }

  // erro final
  console.warn("[comexApiService] Falha ao consultar ComexStat. Retornando lista vazia. Error:", lastErr);
  return [];
}

// ===============================
// ✅ EXPORTS LEGADOS USADOS PELO APP
// ===============================

export async function fetchComexDataByNcm(
  ncm: string,
  year: number,
  flowUi: TradeFlowUi
): Promise<ComexStatRecord[]> {
  const n = normalizeNcmLoose(ncm);
  const typeForm = toApiTypeFormFromUi(flowUi);

  const filterObj = {
    yearStart: String(year),
    yearEnd: String(year),
    typeForm,
    typeOrder: 1,
    filterList: [{ id: "noNcm", filterArray: [n], detailDatabase: [{ id: "noNcmpt", text: "" }] }],
    monthDetail: false,
    metricFOB: true,
    metricKG: true,
    metricStatistic: false,
    metricCIF: false,
    metricFreight: false,
    metricInsurance: false,
    monthStart: "01",
    monthEnd: "12",
    formQueue: "general",
    langDefault: "pt",
  };

  return (await comexGeneralRequest(filterObj)) as ComexStatRecord[];
}

export async function fetchComexDataByNcmPeriod(
  ncm: string,
  period: Period,
  flowUi: TradeFlowUi
): Promise<MonthlyComexStatRecord[]> {
  const n = normalizeNcmLoose(ncm);
  const typeForm = toApiTypeFormFromUi(flowUi);
  const ym = periodToYM(period);

  const filterObj = {
    yearStart: String(ym.yearStart),
    yearEnd: String(ym.yearEnd),
    typeForm,
    typeOrder: 1,
    filterList: [{ id: "noNcm", filterArray: [n], detailDatabase: [{ id: "noNcmpt", text: "" }] }],
    monthDetail: true,
    metricFOB: true,
    metricKG: true,
    metricStatistic: false,
    metricCIF: false,
    metricFreight: false,
    metricInsurance: false,
    monthStart: String(ym.monthStart).padStart(2, "0"),
    monthEnd: String(ym.monthEnd).padStart(2, "0"),
    formQueue: "general",
    langDefault: "pt",
  };

  return (await comexGeneralRequest(filterObj)) as MonthlyComexStatRecord[];
}

export async function fetchComexCountryDataByNcm(
  ncm: string,
  year: number,
  flowUi: TradeFlowUi
): Promise<CountryDataRecord[]> {
  const n = normalizeNcmLoose(ncm);
  const typeForm = toApiTypeFormFromUi(flowUi);

  // Para país: muda o detailDatabase e/ou filtros conforme API.
  // Mantemos o comportamento anterior: pedir por "noCountry" se necessário.
  const filterObj = {
    yearStart: String(year),
    yearEnd: String(year),
    typeForm,
    typeOrder: 1,
    filterList: [
      {
        id: "noNcm",
        filterArray: [n],
        detailDatabase: [{ id: "noNcmpt", text: "" }],
      },
      {
        id: "noCountry",
        filterArray: [],
        detailDatabase: [{ id: "noCountry", text: "" }],
      },
    ],
    monthDetail: false,
    metricFOB: true,
    metricKG: true,
    metricStatistic: false,
    metricCIF: false,
    metricFreight: false,
    metricInsurance: false,
    monthStart: "01",
    monthEnd: "12",
    formQueue: "general",
    langDefault: "pt",
  };

  const data = await comexGeneralRequest(filterObj);
  return (data || []).map((r: any) => ({
    country: String(r?.noCountry ?? r?.country ?? r?.noCountrypt ?? r?.noCountryPt ?? ""),
    metricFOB: safeNumber(r?.metricFOB ?? r?.fob ?? r?.vlFob ?? r?.valueFOB),
    metricKG: safeNumber(r?.metricKG ?? r?.kg ?? r?.vlKg ?? r?.valueKG),
  }));
}

// ===============================
// ✅ EXPORT EXTRA para CGIM: (batch anual por NCM)
// ===============================
export async function fetchComexYearByNcm(
  ncms: string[],
  year: number,
  flow: TradeFlow
): Promise<NcmYearValue[]> {
  const list = (ncms || []).map(normalizeNcmLoose).filter(Boolean);
  if (!list.length) return [];

  const typeForm = toApiTypeForm(flow);

  const filterObj = {
    yearStart: String(year),
    yearEnd: String(year),
    typeForm,
    typeOrder: 1,
    filterList: [
      {
        id: "noNcm",
        filterArray: list,
        detailDatabase: [{ id: "noNcmpt", text: "" }],
      },
    ],
    // anual (sem mês)
    monthDetail: false,
    // métricas principais do CGIM
    metricFOB: true,
    metricKG: true,
    // outros desligados
    metricStatistic: false,
    metricCIF: false,
    metricFreight: false,
    metricInsurance: false,
    monthStart: "01",
    monthEnd: "12",
    formQueue: "general",
    langDefault: "pt",
  };

  const rows = (await comexGeneralRequest(filterObj)) as any[];

  // Normaliza retorno para { ncm, fob, kg }
  const map = new Map<string, NcmYearValue>();
  for (const r of rows || []) {
    const ncm = normalizeNcmLoose(r?.noNcm ?? r?.ncm ?? r?.code ?? "");
    if (!ncm) continue;

    const fob = safeNumber(r?.metricFOB ?? r?.fob ?? r?.vlFob ?? r?.valueFOB);
    const kg = safeNumber(r?.metricKG ?? r?.kg ?? r?.vlKg ?? r?.valueKG);

    map.set(ncm, { ncm, fob, kg });
  }

  // garante todos (inclusive zeros)
  return list.map((n) => map.get(n) || { ncm: n, fob: 0, kg: 0 });
}