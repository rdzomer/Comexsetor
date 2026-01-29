// services/comexApiService.ts
// ✅ CONTRATO LEGADO do App.tsx + ✅ Otimização para Séries Agregadas
// Não remova exports daqui enquanto App.tsx depender deles.

import type { NcmYearValue } from "../utils/cgimTypes";

export type TradeFlowUi = "import" | "export"; // usado pelo App
export type TradeFlow = "imp" | "exp"; // usado pelo CGIM

// ✅ Linha anual por NCM
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
const COMEX_URL = "https://api-comexstat.mdic.gov.br/general";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Faz o POST genérico para a API com Retry e Tratamento de Erro 429
 */
async function comexGeneralRequestWithMeta(payload: any, attempt = 1): Promise<any> {
  const MAX_RETRIES = 3;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const resp = await fetch(COMEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Se der erro 429 (Muitas requisições), espera e tenta de novo
    if (resp.status === 429) {
      if (attempt > MAX_RETRIES) throw new Error("429: Too Many Requests (Max Retries)");
      const delay = 2000 * attempt; 
      console.warn(`[ComexApi] 429 recebido. Tentando novamente em ${delay}ms...`);
      await wait(delay);
      return comexGeneralRequestWithMeta(payload, attempt + 1);
    }

    if (!resp.ok) {
      throw new Error(`Comex Error ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    return data?.data ?? { rows: [] }; 
  } catch (err: any) {
    if (attempt <= MAX_RETRIES && (err.name === 'AbortError' || err.message.includes('Network') || err.message.includes('Failed to fetch'))) {
      console.warn(`[ComexApi] Erro de rede/timeout. Tentativa ${attempt}...`);
      await wait(1500);
      return comexGeneralRequestWithMeta(payload, attempt + 1);
    }
    throw err;
  }
}

// --- FUNÇÕES UTILITÁRIAS (LEGADO) ---

function pickYear(r: any): number | null {
  const candidates = [r?.year, r?.ano, r?.coAno, r?.co_ano, r?.noAno, r?.no_ano];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 1900) return n;
  }
  return null;
}

export async function fetchLastUpdateDate(): Promise<LastUpdateData> {
  try {
    const payload = {
      filters: [],
      groupers: [{ id: "year" }, { id: "month" }],
      metricFOB: true,
      monthDetail: true,
      formQueue: "general",
      langDefault: "pt",
    };
    const data = await comexGeneralRequestWithMeta(payload);
    const rows = data.rows || [];
    if (!rows.length) return { year: new Date().getFullYear(), month: 1 };

    rows.sort((a: any, b: any) => {
      const ya = Number(a.year || a.ano || 0);
      const yb = Number(b.year || b.ano || 0);
      if (ya !== yb) return yb - ya;
      const ma = Number(a.month || a.mes || 0);
      const mb = Number(b.month || b.mes || 0);
      return mb - ma;
    });

    const last = rows[0];
    return {
      year: Number(last.year || last.ano),
      month: Number(last.month || last.mes),
    };
  } catch (e) {
    console.error("Erro fetchLastUpdateDate", e);
    return { year: new Date().getFullYear(), month: 1 };
  }
}

// --- BUSCAS DE DADOS ---

/**
 * Busca dados agregados de 1 ano para 1 NCM (Usado na lógica 1-a-1 antiga)
 */
export async function fetchComexYearByNcm(args: {
  flow: TradeFlow;
  ncm: string;
  year: number;
}): Promise<NcmYearValue> {
  const { flow, ncm, year } = args;
  try {
    const payload = {
      flow,
      filters: [
        { filter: "coNcm", values: [ncm] },
        { filter: "coAno", values: [String(year)] },
      ],
      groupers: [{ id: "coNcm" }], 
      metricFOB: true,
      metricKG: true,
      monthDetail: false,
      formQueue: "general",
      langDefault: "pt",
    };

    const data = await comexGeneralRequestWithMeta(payload);
    const rows = data.rows || [];
    if (!rows.length) return { fob: 0, kg: 0 };

    const r = rows[0];
    return {
      fob: Number(r.metricFOB ?? r.vlFob ?? 0),
      kg: Number(r.metricKG ?? r.kgLiquido ?? 0),
    };
  } catch (e) {
    console.error(`Erro fetchComexYearByNcm ${ncm}/${year}`, e);
    return { fob: 0, kg: 0 };
  }
}

/**
 * Busca lista de NCMs para UM ano específico (Usado pela Tabela Hierárquica)
 */
export async function fetchComexYearByNcmList(args: {
  flow: TradeFlow;
  year: number;
  ncms: string[];
  lite?: boolean; // mantido para compatibilidade, mas ignorado nesta versão otimizada
}): Promise<NcmYearRow[]> {
  const { flow, year, ncms } = args;
  if (!ncms.length) return [];

  // Proteção: API falha se a lista for muito grande na URL, mas no body aguenta mais.
  // Mesmo assim, quem chama essa função geralmente já faz chunking.
  try {
    const payload = {
      flow,
      filters: [
        { filter: "coNcm", values: ncms },
        { filter: "coAno", values: [String(year)] },
      ],
      groupers: [{ id: "coNcm" }], // Agrupa por NCM
      metricFOB: true,
      metricKG: true,
      monthDetail: false,
      formQueue: "general",
      langDefault: "pt",
    };

    const data = await comexGeneralRequestWithMeta(payload);
    const rows = data.rows || [];

    return rows.map((r: any) => ({
      ncm: String(r.coNcm || r.co_ncm || r.ncm),
      fob: Number(r.metricFOB ?? r.vlFob ?? 0),
      kg: Number(r.metricKG ?? r.kgLiquido ?? 0),
    }));
  } catch (e) {
    console.error(`Erro fetchComexYearByNcmList ano ${year}`, e);
    return [];
  }
}

/**
 * 🚀 NOVA FUNÇÃO (A SOLUÇÃO DO PROBLEMA): 
 * Busca série histórica agregada por ANO para uma lista de NCMs.
 * Retorna totais anuais da cesta, sem detalhar por NCM.
 */
export async function fetchAggregatedSeriesByNcmList(args: {
  flow: TradeFlow;
  years: number[];
  ncms: string[];
}): Promise<Array<{ year: number; fob: number; kg: number }>> {
  
  const { flow, years, ncms } = args;
  if (!ncms.length || !years.length) return [];

  try {
    const payload = {
      flow,
      filters: [
        { filter: "coNcm", values: ncms },
        { filter: "coAno", values: years.map(String) },
      ],
      // O SEGREDO: Agrupar por ANO no servidor do MDIC
      groupers: [{ id: "coAno" }], 
      metricFOB: true,
      metricKG: true,
      monthDetail: false, 
      formQueue: "general",
      langDefault: "pt",
    };

    const data = await comexGeneralRequestWithMeta(payload);
    const rows = data.rows || [];
    
    return rows.map((r: any) => ({
      year: Number(r.coAno || r.co_ano || r.ano),
      fob: Number(r.metricFOB ?? r.vlFob ?? 0),
      kg: Number(r.metricKG ?? r.kgLiquido ?? 0),
    })).filter((r: any) => r.year > 0);

  } catch (error) {
    console.error("Erro ao buscar série agregada:", error);
    return [];
  }
}
