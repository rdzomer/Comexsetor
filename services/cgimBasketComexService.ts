// services/cgimBasketComexService.ts
/**
 * CGIM basket service
 * - Canônico: fetchBasketAnnualByNcm(ncms, {flow, years,...}) -> séries por NCM
 * - Compat UI antiga: fetchAnnualBasketByNcm({entity, year, flow, ncms,...}) -> linhas anuais
 */

import {
  fetchComexYearByNcm,
  fetchComexYearByNcmList,
  type NcmYearRow,
  type TradeFlow,
} from "./comexApiService";
import { normalizeNcm } from "../utils/cgimAggregation";

// Tipos mínimos (sem depender de cgimTypes.ts)
export type Year = number;

export interface NcmYearValue {
  fob: number;
  kg: number;
}

export interface NcmSeries {
  ncmRaw: string;
  ncm: string;
  years: Record<string, NcmYearValue>;
}

export interface BasketProgress {
  total: number;
  done: number;
  current?: { ncm: string; year: number };
  stage?: string;
}

export interface BasketOptions {
  flow: TradeFlow;       // "imp" | "exp"
  years: Year[];
  concurrency?: number;  // default 4
  useCache?: boolean;    // default true
  cacheTtlHours?: number;// default 72
  onProgress?: (p: BasketProgress) => void;
  lite?: boolean; // ✅ modo CGIM leve (reduz volume de requests)
}

export interface CgimAnnualBasketRow {
  ncm: string;
  fob: number;
  kg: number;
}

export interface FetchAnnualBasketByNcmArgs {
  entity?: string; // não é usado na consulta, mas pode entrar na chave futuramente
  year: string | number;
  flow: "import" | "export";
  ncms: string[];
  chunkSize?: number;   // usado só para progress simples (aqui também vira batchSize)
  concurrency?: number;
  useCache?: boolean;
  cacheTtlHours?: number;
  onProgress?: (info: { done: number; total: number }) => void;
  lite?: boolean; // ✅ modo CGIM leve
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size || 1));
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function detectCgimLite(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;

  // Sem window (SSR/build): default off
  if (typeof window === "undefined") return false;

  try {
    const qs = new URLSearchParams(window.location.search || "");
    const q = qs.get("cgimLite") || qs.get("lite") || "";
    if (q === "1" || q === "true" || q === "on") return true;
  } catch {
    // ignore
  }

  try {
    const v = window.localStorage?.getItem("cgimLite") || "";
    if (v === "1" || v === "true" || v === "on") return true;
  } catch {
    // ignore
  }

  return false;
}

const DEFAULTS = {
  concurrency: 4,
  useCache: true,
  cacheTtlHours: 72,
};

function cacheKey(flow: TradeFlow, ncm: string, year: number) {
  // ✅ v2 para não reutilizar caches antigos que podem ter gravado zeros por falha de rede/rate-limit
  return `cgim:comex:v2:${flow}:${ncm}:${year}`;
}

function nowMs() {
  return Date.now();
}

function getCached(flow: TradeFlow, ncm: string, year: number, ttlHours: number): NcmYearValue | null {
  const k = cacheKey(flow, ncm, year);
  const raw = localStorage.getItem(k);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { ts: number; fob: number; kg: number };
    if (!obj?.ts) return null;
    if (nowMs() - obj.ts > ttlHours * 3600_000) return null;
    return { fob: Number(obj.fob) || 0, kg: Number(obj.kg) || 0 };
  } catch {
    return null;
  }
}

function setCached(flow: TradeFlow, ncm: string, year: number, value: NcmYearValue) {
  const k = cacheKey(flow, ncm, year);
  try {
    localStorage.setItem(k, JSON.stringify({ ts: nowMs(), fob: value.fob ?? 0, kg: value.kg ?? 0 }));
  } catch {
    // ignore
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * ✅ CANÔNICO: retorna séries por NCM, com years[YYYY] = {fob,kg}
 */
export async function fetchBasketAnnualByNcm(
  ncmListRaw: string[],
  options: BasketOptions
): Promise<NcmSeries[]> {
  const cfg = { ...DEFAULTS, ...options };
  const years = (cfg.years || []).map(Number).filter((y) => Number.isFinite(y));

  const normalized = (ncmListRaw || []).map((raw) => ({ raw, ncm: normalizeNcm(raw) }));
  const valid = normalized.filter((x) => x.ncm) as Array<{ raw: string; ncm: string }>;

  const totalTasks = valid.length * years.length;
  let done = 0;

  const progress = (current?: { ncm: string; year: number }, stage?: string) => {
    cfg.onProgress?.({ total: totalTasks, done, current, stage });
  };

  progress(undefined, "init");

  const tasks: Array<{ ncm: string; ncmRaw: string; year: number }> = [];
  for (const item of valid) {
    for (const y of years) tasks.push({ ncm: item.ncm, ncmRaw: item.raw, year: y });
  }

  const taskResults = await runPool(tasks, cfg.concurrency!, async (t) => {
    progress({ ncm: t.ncm, year: t.year }, "fetch");

    if (cfg.useCache) {
      const cached = getCached(cfg.flow, t.ncm, t.year, cfg.cacheTtlHours!);
      if (cached) {
        done++;
        progress({ ncm: t.ncm, year: t.year }, "cache_hit");
        return { ...t, value: cached };
      }
    }

    const value = await fetchComexYearByNcm({ flow: cfg.flow, ncm: t.ncm, year: t.year });

    if (cfg.useCache) setCached(cfg.flow, t.ncm, t.year, value);

    done++;
    progress({ ncm: t.ncm, year: t.year }, "fetched");

    return { ...t, value };
  });

  const byNcm = new Map<string, NcmSeries>();

  for (const r of taskResults) {
    if (!byNcm.has(r.ncm)) {
      byNcm.set(r.ncm, { ncmRaw: r.ncmRaw, ncm: r.ncm, years: {} });
    }
    byNcm.get(r.ncm)!.years[String(r.year)] = { fob: r.value.fob ?? 0, kg: r.value.kg ?? 0 };
  }

  progress(undefined, "done");
  return Array.from(byNcm.values());
}

/**
 * ✅ COMPAT (UI antiga): retorna linhas anuais {ncm,fob,kg} para UM ano
 * Este é o export que seu CgimAnalyticsPage.tsx está tentando importar.
 */
export async function fetchAnnualBasketByNcm(args: FetchAnnualBasketByNcmArgs): Promise<CgimAnnualBasketRow[]> {
  const yearNum = Number(args.year);
  if (!Number.isFinite(yearNum)) throw new Error(`Ano inválido: ${args.year}`);

  const flow: TradeFlow = args.flow === "export" ? "exp" : "imp";
  const ncms = (args.ncms || []).map((n) => normalizeNcm(n)).filter(Boolean) as string[];

  // =============================
  // ✅ OTIMIZAÇÃO CGIM (BATCH)
  // =============================
  // Motivo: chamar NCM por NCM (200+ requests) costuma disparar rate-limit (429) e/ou timeout.
  // Estratégia: chama em LOTES (chunk) e remonta o resultado.

  const total = ncms.length;
  let done = 0;
  const tick = () => args.onProgress?.({ done, total });

  const useCache = args.useCache ?? true;
  const ttl = args.cacheTtlHours ?? 72;
  const liteDetected = detectCgimLite(args.lite);

// ✅ Robustez (produção): cestas grandes estouram 429 fácil.
// Estratégia mínima: força modo "lite" quando a cesta é grande, e executa em 1 fila.
const lite = total > 30 ? true : liteDetected;

// ✅ sempre 1 por vez (a fila global do comexApiService já ajuda, mas aqui evitamos rajada de enfileiramento)
const concurrency = 1;

// ✅ batch menor = menos chance de 429 e de truncamento parcial
const batchSize = lite ? 8 : Math.max(8, Math.min(25, args.chunkSize ?? 15));

  // 1) tenta resolver via cache primeiro
  const valuesByNcm = new Map<string, { fob: number; kg: number }>();
  const pending: string[] = [];

  for (const ncm of ncms) {
    if (useCache) {
      const cached = getCached(flow, ncm, yearNum, ttl);
      if (cached) {
        valuesByNcm.set(ncm, { fob: cached.fob ?? 0, kg: cached.kg ?? 0 });
        done++;
        continue;
      }
    }
    pending.push(ncm);
  }
  tick();

  // 2) consulta pendentes em lotes
  const chunks = chunkArray(pending, batchSize);

  // Helper: tenta resolver NCMs faltantes com lotes menores e, se necessário, 1-a-1.
  // Motivo: o endpoint em lote do ComexStat às vezes retorna apenas parte das NCMs do payload
  // (limite de tamanho/URL, limite interno, ou falhas intermitentes).
  async function resolveMissing(missing: string[]): Promise<void> {
    if (!missing.length) return;

    // 2.1) tenta novamente em lotes menores (reduz chance de truncamento/limite)
    const retryBatchSize = 15;
    const retryChunks = chunkArray(missing, retryBatchSize);

    for (const sub of retryChunks) {
      let subRows: NcmYearRow[] = [];
      try {
        subRows = await fetchComexYearByNcmList({ flow, year: yearNum, ncms: sub, lite });
      } catch {
        subRows = [];
      }

      const got2 = new Map<string, { fob: number; kg: number }>();
      for (const r of subRows || []) {
        const n = r?.ncm;
        if (!n) continue;
        const v = { fob: Number(r.fob) || 0, kg: Number(r.kg) || 0 };
        got2.set(n, v);
        valuesByNcm.set(n, v);
        // ✅ Evita “congelar” zeros no cache quando a API falha / rate limit.
        // (zeros reais podem existir, mas são raros; o custo de refetch é aceitável)
        if (useCache && (v.fob !== 0 || v.kg !== 0)) setCached(flow, n, yearNum, v);
      }

      // 2.2) ainda faltou? tenta 1-a-1 (mais lento, mas evita zerar indevidamente)
      for (const n of sub) {
        if (got2.has(n)) continue;
        const v = await fetchComexYearByNcm({ flow, ncm: n, year: yearNum });
        const vv = { fob: Number(v.fob) || 0, kg: Number(v.kg) || 0 };
        valuesByNcm.set(n, vv);
        if (useCache && (vv.fob !== 0 || vv.kg !== 0)) setCached(flow, n, yearNum, vv);
      }
    }
  }

  await runPool(chunks, concurrency, async (chunk) => {
    let rows: NcmYearRow[] = [];
    try {
      rows = await fetchComexYearByNcmList({ flow, year: yearNum, ncms: chunk, lite });
    } catch {
      // fallback abaixo
      rows = [];
    }

    // Mapa do que veio no lote
    const got = new Map<string, { fob: number; kg: number }>();
    for (const r of rows || []) {
      const n = r?.ncm;
      if (!n) continue;
      const v = { fob: Number(r.fob) || 0, kg: Number(r.kg) || 0 };
      got.set(n, v);
      valuesByNcm.set(n, v);
      if (useCache && (v.fob !== 0 || v.kg !== 0)) {
        // ✅ evita “congelar” zeros no cache quando a API falha / rate limit
        setCached(flow, n, yearNum, v);
      }
    }

    // completa faltantes do lote:
    // - se o lote vier vazio: fallback 1-a-1 (já existia)
    // - se o lote vier parcial: tenta resolver faltantes (lotes menores -> 1-a-1)
    if (rows.length === 0) {
      // fallback: tenta 1-a-1 para não ficar tudo zerado quando o endpoint em lote falhar
      for (const n of chunk) {
        const v = await fetchComexYearByNcm({ flow, ncm: n, year: yearNum });
        const vv = { fob: Number(v.fob) || 0, kg: Number(v.kg) || 0 };
        valuesByNcm.set(n, vv);
        if (useCache && (vv.fob !== 0 || vv.kg !== 0)) {
          // ✅ evita “congelar” zeros no cache quando a API falha / rate limit
          setCached(flow, n, yearNum, vv);
        }
        done++;
        tick();
      }
      return [];
    }

    const missing = chunk.filter((n) => !got.has(n));
    if (missing.length) {
      await resolveMissing(missing);
    }

    for (const n of chunk) {
      // Se ainda faltar após as tentativas, assume 0 — mas NÃO faz cache desse 0
      // (senão você “congela” um erro de rede como se fosse dado real).
      if (!valuesByNcm.has(n)) valuesByNcm.set(n, { fob: 0, kg: 0 });
      done++;
    }
    tick();
    return [];
  });

  // 3) devolve no mesmo conjunto (um item por NCM)
  const out: CgimAnnualBasketRow[] = ncms.map((ncm) => {
    const v = valuesByNcm.get(ncm) ?? { fob: 0, kg: 0 };
    return { ncm, fob: v.fob, kg: v.kg };
  });

  done = total;
  tick();
  return out;
}
