// services/cgimBasketTimeseriesService.ts
import { fetchComexYearByNcmList, type TradeFlowUi } from "./comexApiService";

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

  // ✅ Evita 429 (rate limit) no modo “cesta completa”:
  // ao invés de um POST gigante com todos os NCMs + vários anos,
  // buscamos ano a ano usando o helper já chunkado (fetchComexYearByNcmList).
  const out: BasketAnnualPoint[] = [];

  // ✅ Robustez: séries anuais chamam /general várias vezes (ano a ano).
// Para evitar 429 em produção, forçamos "lite" quando a cesta é média/grande e aplicamos delay fixo.
const lite = ncms.length > 25;
const delayMs = lite ? 750 : 250;

  for (let y = yearStart; y <= yearEnd; y++) {
    if (delayMs) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const rows = await fetchComexYearByNcmList({
      flow,
      year: y,
      ncms,
      lite,
    });

    let fob = 0;
    let kg = 0;
    for (const r of rows || []) {
      fob += Number(r?.fob ?? 0) || 0;
      kg += Number(r?.kg ?? 0) || 0;
    }

    const usdPerTon = kg > 0 ? fob / (kg / 1000) : 0;
    out.push({ year: y, fob, kg, usdPerTon });
  }

  // ✅ não cachear vazio (evita “congelar” falha / rate limit)
  if (useCache && out.some((p) => (p.fob ?? 0) !== 0 || (p.kg ?? 0) !== 0)) {
    setCache(key, out);
  }

  return out;
}
