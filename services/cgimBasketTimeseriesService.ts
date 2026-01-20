// services/cgimBasketTimeseriesService.ts
import { fetchComexData, type TradeFlowUi } from "./comexApiService";

export type BasketAnnualPoint = {
  year: number;
  fob: number;
  kg: number;
  usdPerTon: number;
};

function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickYear(r: any): number | null {
  const candidates = [
    r?.year,
    r?.ano,
    r?.coAno,
    r?.co_ano,
    r?.noAno,
    r?.no_ano,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 1900) return n;
  }
  return null;
}

function pickFOB(r: any): number {
  return toNumber(r?.metricFOB ?? r?.vlFob ?? r?.vl_fob ?? r?.fob);
}

function pickKG(r: any): number {
  return toNumber(r?.metricKG ?? r?.kgLiquido ?? r?.kg_liquido ?? r?.kg);
}

function cacheKey(flow: TradeFlowUi, yearStart: number, yearEnd: number, ncms: string[]) {
  // key curta (hash simples)
  const joined = (ncms || []).slice().sort().join(",");
  let h = 0;
  for (let i = 0; i < joined.length; i++) h = (h * 31 + joined.charCodeAt(i)) >>> 0;
  return `cgim:basket:annual:${flow}:${yearStart}-${yearEnd}:${h}:${ncms.length}`;
}

function getCache(key: string, ttlHours = 24): BasketAnnualPoint[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { ts: number; data: BasketAnnualPoint[] };
    if (!obj?.ts || !Array.isArray(obj.data)) return null;
    if (Date.now() - obj.ts > ttlHours * 3600_000) return null;
    return obj.data;
  } catch {
    return null;
  }
}

function setCache(key: string, data: BasketAnnualPoint[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ignore
  }
}

export async function fetchBasketAnnualSeries(args: {
  flow: TradeFlowUi;           // "import" | "export"
  yearStart: number;           // ex 2015
  yearEnd: number;             // ex 2025
  ncms: string[];              // NCMs 8 dígitos
  useCache?: boolean;
  cacheTtlHours?: number;
}): Promise<BasketAnnualPoint[]> {
  const flow = args.flow;
  const yearStart = Number(args.yearStart);
  const yearEnd = Number(args.yearEnd);
  const ncms = (args.ncms || []).filter(Boolean);

  if (!ncms.length) return [];

  const key = cacheKey(flow, yearStart, yearEnd, ncms);
  const useCache = args.useCache ?? true;
  const ttl = args.cacheTtlHours ?? 24;

  if (useCache) {
    const cached = getCache(key, ttl);
    if (cached) return cached;
  }

  const period = { from: `${yearStart}-01`, to: `${yearEnd}-12` };

  const rows = await fetchComexData(
    flow,
    period,
    [{ filter: "ncm", values: ncms }],
    ["metricFOB", "metricKG"],
    [] // sem groupBy -> agregado por ano (como no módulo NCM)
  );

  // agrega defensivamente por ano (caso a API retorne múltiplas linhas)
  const byYear = new Map<number, { fob: number; kg: number }>();

  for (const r of rows || []) {
    const y = pickYear(r);
    if (!y) continue;
    const fob = pickFOB(r);
    const kg = pickKG(r);

    if (!byYear.has(y)) byYear.set(y, { fob: 0, kg: 0 });
    const cur = byYear.get(y)!;
    cur.fob += fob;
    cur.kg += kg;
  }

  const out: BasketAnnualPoint[] = Array.from(byYear.entries())
    .map(([year, v]) => {
      const usdPerTon = v.kg > 0 ? v.fob / (v.kg / 1000) : 0;
      return { year, fob: v.fob, kg: v.kg, usdPerTon };
    })
    .sort((a, b) => a.year - b.year);

  if (useCache) setCache(key, out);
  return out;
}
