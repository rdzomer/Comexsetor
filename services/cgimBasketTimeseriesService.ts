// services/cgimBasketTimeseriesService.ts
import { fetchAggregatedSeriesByNcmList, type TradeFlow, type TradeFlowUi } from "./comexApiService";

export type BasketAnnualPoint = {
  year: number;
  fob: number;
  kg: number;
  usdPerTon: number;
};

// Configuração de Chunking para evitar "URI Too Long" ou 429 no filtro
const NCM_CHUNK_SIZE = 500; 

function getTradeFlow(uiFlow: TradeFlowUi): TradeFlow {
  return uiFlow === "import" ? "imp" : "exp";
}

export async function fetchBasketAnnualSeries(args: {
  entityName: string; // Usado para cache key
  flowUi: TradeFlowUi;
  yearStart: number;
  yearEnd: number;
  ncms: string[];
}): Promise<BasketAnnualPoint[]> {
  const { flowUi, yearStart, yearEnd, ncms } = args;
  
  if (!ncms || ncms.length === 0) return [];

  // 1. Gera lista de anos
  const years: number[] = [];
  for (let y = yearStart; y <= yearEnd; y++) years.push(y);

  // 2. Cache Key (Simples)
  const cacheKey = `cgim_series_v2_${args.entityName}_${flowUi}_${yearStart}_${yearEnd}_${ncms.length}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    console.log(`[TimeSeries] Cache Hit para ${args.entityName}`);
    return JSON.parse(cached);
  }

  // 3. Prepara Chunks de NCM
  const chunks: string[][] = [];
  for (let i = 0; i < ncms.length; i += NCM_CHUNK_SIZE) {
    chunks.push(ncms.slice(i, i + NCM_CHUNK_SIZE));
  }

  console.log(`[TimeSeries] Buscando série ${yearStart}-${yearEnd} para ${ncms.length} NCMs em ${chunks.length} lotes.`);

  // 4. Executa requisições (Agregadas por Ano)
  // Usamos Promise.all para disparar os chunks em paralelo (limitado pelo navegador)
  // Como cada request retorna SÓ os totais anuais, é leve.
  
  const flow = getTradeFlow(flowUi);
  const promises = chunks.map(chunk => 
    fetchAggregatedSeriesByNcmList({ flow, years, ncms: chunk })
  );

  const results = await Promise.all(promises);

  // 5. Consolida os resultados (Soma os chunks)
  const totalsByYear = new Map<number, { fob: number; kg: number }>();

  // Inicializa mapa com zeros para garantir que todos anos apareçam (inclusive vazios)
  years.forEach(y => totalsByYear.set(y, { fob: 0, kg: 0 }));

  results.flat().forEach(row => {
    const current = totalsByYear.get(row.year);
    if (current) {
      current.fob += row.fob;
      current.kg += row.kg;
    }
  });

  // 6. Formata saída final
  const output: BasketAnnualPoint[] = Array.from(totalsByYear.entries())
    .sort((a, b) => a[0] - b[0]) // Ordena por ano
    .map(([year, val]) => ({
      year,
      fob: val.fob,
      kg: val.kg,
      usdPerTon: val.kg > 0 ? val.fob / val.kg : 0
    }));

  // 7. Salva no Cache
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(output));
  } catch (e) {
    console.warn("Storage cheio, ignorando cache de série.");
  }

  return output;
}
