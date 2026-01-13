// services/cgimBasketComexService.ts
/**
 * CGIM basket service
 * - Canônico: fetchBasketAnnualByNcm(ncms, {flow, years,...}) -> séries por NCM
 * - Compat UI antiga: fetchAnnualBasketByNcm({entity, year, flow, ncms,...}) -> linhas anuais
 */

import { fetchComexYearByNcm, type TradeFlow } from "./comexApiService";
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
  chunkSize?: number;   // usado só para progress simples
  concurrency?: number;
  useCache?: boolean;
  cacheTtlHours?: number;
  onProgress?: (info: { done: number; total: number }) => void;
}

const DEFAULTS = {
  concurrency: 4,
  useCache: true,
  cacheTtlHours: 72,
};

function cacheKey(flow: TradeFlow, ncm: string, year: number) {
  return `cgim:comex:${flow}:${ncm}:${year}`;
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

  const total = ncms.length;
  let done = 0;

  const tick = () => args.onProgress?.({ done, total });

  // Usa o canônico por baixo (1 ano só)
  const seriesList = await fetchBasketAnnualByNcm(ncms, {
    flow,
    years: [yearNum],
    concurrency: args.concurrency ?? 2,
    useCache: args.useCache ?? true,
    cacheTtlHours: args.cacheTtlHours ?? 72,
    onProgress: (p) => {
      // p.done é tasks (ncm*anos). Aqui anos=1, então aproxima:
      done = Math.min(total, p.done);
      tick();
    },
  });

  const out: CgimAnnualBasketRow[] = seriesList.map((s) => {
    const v = s.years[String(yearNum)] ?? { fob: 0, kg: 0 };
    return {
      ncm: s.ncm,
      fob: Number(v.fob) || 0,
      kg: Number(v.kg) || 0,
    };
  });

  done = total;
  tick();

  return out;
}
