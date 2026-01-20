import { normalizeNcm } from "../utils/cgimAggregation";
import {
  fetchComexYearByNcm,
  fetchComexYearByNcmList,
  normalizeNcmTo8,
  type TradeFlow,
} from "./comexApiService";

export type Year = number;

export type BasketProgress = {
  done: number;
  total: number;
};

export interface BasketOptions {
  flow: TradeFlow;       // "imp" | "exp"
  years: Year[];
  concurrency?: number;  // default 4
  chunkSize?: number;    // default 80 (tamanho do lote por chamada no ComexStat)
  useCache?: boolean;    // default true
  cacheTtlHours?: number;// default 72
  onProgress?: (p: BasketProgress) => void;
}

export type NcmSeries = {
  ncm: string;          // 8 dígitos
  raw: string;          // como veio
  years: Record<number, { fob: number; kg: number }>;
};

const DEFAULTS = {
  concurrency: 4,
  chunkSize: 80,
  useCache: true,
  cacheTtlHours: 72,
};

function nowMs() {
  return Date.now();
}

type CacheItem = {
  ts: number;
  v: { fob: number; kg: number };
};

function cacheKey(flow: TradeFlow, year: number, ncm: string) {
  // "v2" para invalidar cache antigo que pode ter sido preenchido com zeros
  // quando a API falhou em lote (evita "envenenar" a árvore com zeros por 72h).
  return `cgimBasket:v2:${flow}:${year}:${ncm}`;
}

function getCached(flow: TradeFlow, year: number, ncm: string, ttlHours: number): CacheItem | null {
  try {
    const raw = localStorage.getItem(cacheKey(flow, year, ncm));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheItem;
    if (!parsed?.ts || !parsed?.v) return null;
    const ageMs = nowMs() - parsed.ts;
    if (ageMs > ttlHours * 3600 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setCached(flow: TradeFlow, year: number, ncm: string, v: { fob: number; kg: number }) {
  try {
    const item: CacheItem = { ts: nowMs(), v };
    localStorage.setItem(cacheKey(flow, year, ncm), JSON.stringify(item));
  } catch {
    // ignore
  }
}

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const cur = idx++;
      results[cur] = await tasks[cur]();
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function fetchBasketAnnualByNcm(
  ncmListRaw: string[],
  options: BasketOptions
): Promise<NcmSeries[]> {
  const cfg = { ...DEFAULTS, ...options };
  const years = (cfg.years || []).map(Number).filter((y) => Number.isFinite(y));

  // normaliza NCMs, mantendo raw
  const valid = (ncmListRaw || [])
    .map((raw) => ({ raw, ncm: normalizeNcm(raw) }))
    .filter((x) => x.ncm && x.ncm.length === 8);

  const totalTasks = valid.length * years.length;
  let done = 0;
  const onProgress = cfg.onProgress;

  const byNcm: Map<string, NcmSeries> = new Map();
  for (const item of valid) {
    if (!byNcm.has(item.ncm)) {
      byNcm.set(item.ncm, { ncm: item.ncm, raw: item.raw, years: {} });
    }
  }

  // ✅ NOVO: por ano, busca em lotes (bem menos chamadas => bem menos timeout)
  for (const y of years) {
    const toFetch: string[] = [];

    // 1) cache primeiro
    for (const item of valid) {
      const serie = byNcm.get(item.ncm)!;

      if (cfg.useCache) {
        const cached = getCached(cfg.flow, y, item.ncm, cfg.cacheTtlHours);
        if (cached) {
          serie.years[y] = cached.v;
          done++;
          onProgress?.({ done, total: totalTasks });
          continue;
        }
      }

      // precisa buscar
      toFetch.push(item.ncm);
    }

    if (!toFetch.length) continue;

    const BATCH_SIZE = Math.max(1, Number(cfg.chunkSize) || 80);
    const batches: string[][] = [];
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      batches.push(toFetch.slice(i, i + BATCH_SIZE));
    }

    const tasks = batches.map((batch) => async () => {
      const rows = await fetchComexYearByNcmList({
        flow: cfg.flow,
        year: y,
        ncms: batch.map((n) => normalizeNcmTo8(n)),
      });

      // Se o lote voltou vazio, isso quase sempre é falha (timeout/URL grande/rate limit).
      // Nessa situação, NÃO salvamos cache de zeros (para não travar a entidade por horas).
      const apiLikelyFailed = (rows?.length ?? 0) === 0 && batch.length > 0;

      const map = new Map<string, { fob: number; kg: number }>();
      for (const r of rows) {
        map.set(normalizeNcmTo8(r.ncm), { fob: r.fob, kg: r.kg });
      }

      // completa faltantes com 0 e salva cache/serie
      for (const ncm of batch) {
        const n8 = normalizeNcmTo8(ncm);
        const v = map.get(n8) ?? { fob: 0, kg: 0 };
        const serie = byNcm.get(n8)!;
        serie.years[y] = v;

        if (cfg.useCache && !apiLikelyFailed) setCached(cfg.flow, y, n8, v);

        done++;
        onProgress?.({ done, total: totalTasks });
      }

      return true;
    });

    await runPool(tasks, cfg.concurrency);
  }

  return Array.from(byNcm.values());
}

export type CgimAnnualBasketRow = {
  ncm: string;
  fob: number;
  kg: number;
};

type FlowType = "import" | "export";

export async function fetchAnnualBasketByNcm(args: {
  entity: string;
  year: string;
  flow: FlowType;
  ncms: string[];
  chunkSize?: number;
  concurrency?: number;
  onProgress?: (p: { done: number; total: number }) => void;
  useCache?: boolean;
  cacheTtlHours?: number;
}): Promise<CgimAnnualBasketRow[]> {
  const yearNum = Number(args.year);
  const flow: TradeFlow = args.flow === "export" ? "exp" : "imp";
  const ncms = (args.ncms || []).map((n) => normalizeNcm(n)).filter(Boolean);

  const seriesList = await fetchBasketAnnualByNcm(ncms, {
    flow,
    years: [yearNum],
    concurrency: args.concurrency ?? 2,
    chunkSize: args.chunkSize ?? 80,
    useCache: args.useCache ?? true,
    cacheTtlHours: args.cacheTtlHours ?? 72,
    onProgress: (p) => {
      args.onProgress?.(p);
    },
  });

  return seriesList.map((s) => ({
    ncm: s.ncm,
    fob: s.years[yearNum]?.fob ?? 0,
    kg: s.years[yearNum]?.kg ?? 0,
  }));
}
