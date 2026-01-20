// components/CgimAnalyticsPage.tsx
import React from "react";
import { CgimHierarchyTable } from "./CgimHierarchyTable";
import SimpleLineChart from "./charts/SimpleLineChart";
import SimpleBarChart from "./charts/SimpleBarChart";

import {
  buildHierarchyTree,
  computeTotal,
  listCategories,
  listSubcategories,
  type DetailLevel,
  type HierarchyNode,
  type DictionaryRow,
} from "../utils/cgimAggregation";

import * as cgimDictionaryService from "../services/cgimDictionaryService";
import {
  fetchAnnualBasketByNcm,
  type CgimAnnualBasketRow,
} from "../services/cgimBasketComexService";
import { fetchBasketAnnualSeries } from "../services/cgimBasketTimeseriesService";

type SortKey = "fob" | "kg";
type SortDir = "asc" | "desc";
type FlowType = "import" | "export";
type ViewMode = "TABLE" | "CHARTS" | "BOTH";

function formatMoneyUS(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}
function formatKg(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}
function formatUsdPerTon(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

function normalizeNcm(v: any): string {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.padStart(8, "0").slice(0, 8);
}

function pickFn<T extends Function>(obj: any, names: string[]): T {
  for (const n of names) {
    const fn = obj?.[n];
    if (typeof fn === "function") return fn as T;
  }
  throw new Error(
    `Não encontrei função no cgimDictionaryService. Exporte uma destas: ${names.join(
      ", "
    )}`
  );
}

function truncateLabel(s: string, max = 70) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function isEmptySubValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return v === 0;
  const s = String(v).trim();
  return s === "" || s === "0";
}

function buildSubcategoryLabel(
  subs: Array<string | null>,
  depth: number
): string | null {
  const parts = subs
    .slice(0, depth)
    .map((s) => (isEmptySubValue(s) ? "" : String(s ?? "").trim()))
    .filter(Boolean);

  if (!parts.length) return null;
  return parts.join(" > ");
}

// ✅ Cesta dos gráficos a partir do dicionário (não depende da árvore do ano)
function collectNcmsFromDictionary(args: {
  dictRowsAll: DictionaryRow[];
  selectedCategories: string[];
  selectedSubcategories: string[];
}): string[] {
  const { dictRowsAll, selectedCategories, selectedSubcategories } = args;
  const catSet = new Set((selectedCategories || []).filter(Boolean));
  const subSet = new Set((selectedSubcategories || []).filter(Boolean));

  const out = new Set<string>();

  for (const r of dictRowsAll || []) {
    if (catSet.size && !catSet.has(r.categoria)) continue;
    const sub = r.subcategoria || "Sem subcategoria";
    if (subSet.size && !subSet.has(sub)) continue;

    const n = normalizeNcm(r.ncm);
    if (n) out.add(n);
  }

  return Array.from(out);
}

export default function CgimAnalyticsPage() {
  const [entity, setEntity] = React.useState<string>("IABR");
  const [year, setYear] = React.useState<number>(2024);
  const [flow, setFlow] = React.useState<FlowType>("import");

  const [detailLevel, setDetailLevel] =
    React.useState<DetailLevel>("SUBCATEGORY");
  const [subcatDepth, setSubcatDepth] = React.useState<number>(1);
  const [maxSubcatDepth, setMaxSubcatDepth] = React.useState<number>(1);

  const [sortKey, setSortKey] = React.useState<SortKey>("fob");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>(
    []
  );
  const [selectedSubcategories, setSelectedSubcategories] = React.useState<
    string[]
  >([]);

  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [tree, setTree] = React.useState<HierarchyNode[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  const [entities, setEntities] = React.useState<string[]>([
    "IABR",
    "ABIVIDRO",
    "ABAL",
    "IBÁ",
  ]);
  const years = React.useMemo(() => [2022, 2023, 2024, 2025], []);

  const [viewMode, setViewMode] = React.useState<ViewMode>("BOTH");

  // ✅ guarda dicionário completo (para cesta dos gráficos + seed)
  const [dictRowsAll, setDictRowsAll] = React.useState<DictionaryRow[]>([]);

  // charts
  const [chartsLoading, setChartsLoading] = React.useState(false);
  const [chartsError, setChartsError] = React.useState<string | null>(null);
  const [annualSeries, setAnnualSeries] = React.useState<any[]>([]);
  const [annualPriceSeries, setAnnualPriceSeries] = React.useState<any[]>([]);
  const [categoryBars, setCategoryBars] = React.useState<any[]>([]);
  const [subcatBars, setSubcatBars] = React.useState<any[]>([]);

  const [diagnostics, setDiagnostics] = React.useState<{
    dictRows: number;
    distinctNcms: number;
    comexRows: number;
    comexZeroRows: number;
    apiLikelyDown: boolean;
    maxDepth: number;
    duplicateNcms: number;
    conflictingMappings: number;
  } | null>(null);

  const loadDictionary = React.useMemo(() => {
    return pickFn<
      (entity: string) => Promise<cgimDictionaryService.CgimDictEntry[]>
    >(cgimDictionaryService, [
      "loadCgimDictionaryForEntity",
      "loadDictionaryForEntity",
      "getCgimDictionaryForEntity",
      "getDictionaryForEntity",
    ]);
  }, []);

  // entities pack
  React.useEffect(() => {
    let cancelled = false;
    async function loadEntitiesFromExcel() {
      try {
        const pack = await cgimDictionaryService.loadCgimDictionaryFromExcel();
        if (cancelled) return;
        const list = (pack.entities ?? []).filter(Boolean);
        if (list.length) {
          setEntities(list);
          if (!list.includes(entity)) setEntity(list[0]);
        }
      } catch {
        // ignore
      }
    }
    loadEntitiesFromExcel();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // main load
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setTree([]);
      setExpandedIds(new Set());
      setDiagnostics(null);
      setError(null);
      setLastUpdated(null);

      setLoading(true);
      setProgress(null);

      try {
        const dictEntries = await loadDictionary(entity);

        const maxDepthFound =
          dictEntries.reduce((acc, e) => {
            const depth = (e.subcategorias ?? []).filter(
              (x) => !isEmptySubValue(x)
            ).length;
            return Math.max(acc, depth);
          }, 0) || 1;

        setMaxSubcatDepth(maxDepthFound);

        const effectiveDepth = Math.min(subcatDepth, maxDepthFound || 1);
        if (effectiveDepth !== subcatDepth) setSubcatDepth(effectiveDepth);

        // ✅ linhas completas (SEM dedup) -> seed e cesta dos gráficos
        const dictRowsRawAll: DictionaryRow[] = (dictEntries ?? [])
          .map((e) => {
            const categoria =
              String(e.categoria ?? "").trim() ||
              "Sem categoria (mapeamento incompleto)";
            const subLabel = buildSubcategoryLabel(
              e.subcategorias ?? [],
              effectiveDepth
            );
            return {
              ncm: normalizeNcm(e.ncm),
              categoria,
              subcategoria: subLabel,
            } as any;
          })
          .filter((r) => !!r.ncm) as DictionaryRow[];

        setDictRowsAll(dictRowsRawAll);

        // ✅ dedup por NCM (mapeamento estável)
        const seen = new Map<
          string,
          { categoria: string; subcategoria: string | null }
        >();
        let duplicateNcms = 0;
        let conflictingMappings = 0;

        const dictRowsDedup: DictionaryRow[] = [];
        for (const r of dictRowsRawAll) {
          const ncm = normalizeNcm(r.ncm);
          if (!ncm) continue;

          const nextMap = {
            categoria: r.categoria,
            subcategoria: r.subcategoria ?? null,
          };

          if (!seen.has(ncm)) {
            seen.set(ncm, nextMap);
            dictRowsDedup.push({ ...r, ncm });
            continue;
          }

          duplicateNcms++;
          const prev = seen.get(ncm)!;
          const isConflict =
            prev.categoria !== nextMap.categoria ||
            (prev.subcategoria ?? null) !== (nextMap.subcategoria ?? null);

          if (isConflict) conflictingMappings++;
          // mantém o primeiro (primeiro wins)
        }

        const ncmsAllUnique = Array.from(
          new Set(
            dictRowsRawAll.map((r) => normalizeNcm(r.ncm)).filter(Boolean)
          )
        ) as string[];

        const basketRows: CgimAnnualBasketRow[] = await fetchAnnualBasketByNcm({
          entity,
          year: String(year),
          flow,
          ncms: ncmsAllUnique,
          chunkSize: 60,
          concurrency: 2,
          onProgress: (info) => {
            if (!cancelled) setProgress(info);
          },
        });

        if (cancelled) return;

        const comexRows = basketRows.map((r) => ({
          ncm: r.ncm,
          metricFOB: r.fob,
          metricKG: r.kg,
        }));

        const comexZeroRows = comexRows.filter(
          (r) =>
            (Number(r.metricFOB) || 0) === 0 && (Number(r.metricKG) || 0) === 0
        ).length;

        const apiLikelyDown =
          comexRows.length > 0 && comexZeroRows === comexRows.length;

        setDiagnostics({
          dictRows: dictRowsRawAll.length,
          distinctNcms: ncmsAllUnique.length,
          comexRows: comexRows.length,
          comexZeroRows,
          apiLikelyDown,
          maxDepth: maxDepthFound,
          duplicateNcms,
          conflictingMappings,
        });

        // ✅ FIX: seedGroupsFromDictionary + seedRows
        const nextTree = buildHierarchyTree({
          dictRows: dictRowsDedup,
          seedRows: dictRowsRawAll,
          comexRows,
          includeUnmapped: true,
          includeAllZero: apiLikelyDown,
          seedGroupsFromDictionary: true,
          includeZeroLeaves: false,
        });

        setTree(nextTree);
        setLastUpdated(new Date());
        setExpandedIds(new Set());
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ? String(e.message) : "Erro ao carregar dados.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProgress(null);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, year, flow, subcatDepth]);

  const availableCategories = React.useMemo(() => listCategories(tree), [tree]);
  const availableSubcategories = React.useMemo(
    () => listSubcategories(tree, selectedCategories),
    [tree, selectedCategories]
  );

  const total = React.useMemo(() => computeTotal(tree), [tree]);

  // ✅ charts: cesta via dicionário
  React.useEffect(() => {
    let cancelled = false;
    let t: any = null;

    async function runCharts() {
      if (!dictRowsAll.length) {
        setAnnualSeries([]);
        setAnnualPriceSeries([]);
        setCategoryBars([]);
        setSubcatBars([]);
        return;
      }

      setChartsLoading(true);
      setChartsError(null);

      try {
        const ncms = collectNcmsFromDictionary({
          dictRowsAll,
          selectedCategories,
          selectedSubcategories,
        });

        if (!ncms.length) {
          setAnnualSeries([]);
          setAnnualPriceSeries([]);
          setCategoryBars([]);
          setSubcatBars([]);
          return;
        }

        const yearStart = 2015;
        const yearEnd = 2025;

        const series = await fetchBasketAnnualSeries({
          flow,
          yearStart,
          yearEnd,
          ncms,
          useCache: true,
          cacheTtlHours: 24,
        });

        if (cancelled) return;

        setAnnualSeries(
          series.map((p) => ({
            name: String(p.year),
            fob: p.fob,
            kg: p.kg,
          }))
        );

        setAnnualPriceSeries(
          series.map((p) => ({
            name: String(p.year),
            usdPerTon: p.usdPerTon,
          }))
        );

        // barras usando a árvore (com seed), ok
        const catSet = new Set((selectedCategories || []).filter(Boolean));
        const subSet = new Set((selectedSubcategories || []).filter(Boolean));

        const cats: any[] = [];
        for (const cat of tree) {
          if (catSet.size && !catSet.has(cat.name)) continue;
          cats.push({ name: cat.name, fob: cat.metrics.fob });
        }
        cats.sort((a, b) => (b.fob || 0) - (a.fob || 0));
        setCategoryBars(cats.slice(0, 20));

        const subs: any[] = [];
        for (const cat of tree) {
          if (catSet.size && !catSet.has(cat.name)) continue;
          for (const sub of cat.children || []) {
            if (sub.level !== "subcategory") continue;
            if (subSet.size && !subSet.has(sub.name)) continue;
            subs.push({
              name: `${cat.name} • ${sub.name}`,
              fob: sub.metrics.fob,
            });
          }
        }
        subs.sort((a, b) => (b.fob || 0) - (a.fob || 0));
        setSubcatBars(subs.slice(0, 25));
      } catch (e: any) {
        if (cancelled) return;
        setChartsError(
          e?.message ? String(e.message) : "Erro ao carregar gráficos."
        );
      } finally {
        if (!cancelled) setChartsLoading(false);
      }
    }

    t = setTimeout(runCharts, 250);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [dictRowsAll, selectedCategories, selectedSubcategories, flow, tree]);

  const expandAll = React.useCallback(() => {
    const ids = new Set<string>();
    for (const cat of tree) {
      ids.add(cat.id);
      for (const ch of cat.children ?? []) {
        if (ch.level === "subcategory") ids.add(ch.id);
      }
    }
    setExpandedIds(ids);
  }, [tree]);

  const collapseAll = React.useCallback(() => setExpandedIds(new Set()), []);
  const resetFilters = React.useCallback(() => {
    setSelectedCategories([]);
    setSelectedSubcategories([]);
  }, []);

  const cardStyle: React.CSSProperties = {
    border: "1px solid #e6e6e6",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
  };

  const controlRow: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 12,
  };

  const filtersStack: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const selectBoxStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ddd",
  };

  const multiSelectStyleBase: React.CSSProperties = {
    ...selectBoxStyle,
    minHeight: 140,
  };
  const multiSelectSubcatStyle: React.CSSProperties = {
    ...selectBoxStyle,
    minHeight: 260,
  };

  // ✅ AQUI: barra sticky volta a cobrir TABELA e GRÁFICOS
  const showTopLoading = loading || chartsLoading;
  const topLoadingTitle = loading ? "Carregando tabela…" : "Carregando gráficos…";
  const hasProgress = !!(progress && progress.total);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, Math.round((progress!.done / progress!.total) * 100)))
    : 0;

  return (
    <div
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
    >
      {showTopLoading && (
        <div
          style={{
            ...cardStyle,
            position: "sticky",
            top: 10,
            zIndex: 50,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
          >
            <div style={{ fontWeight: 800 }}>{topLoadingTitle}</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {hasProgress ? `${progress!.done}/${progress!.total}` : "—"}
            </div>
          </div>

          <div
            style={{
              height: 8,
              marginTop: 8,
              borderRadius: 999,
              background: "#e9e9e9",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Determinada (tabela) */}
            {hasProgress && (
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: "#111",
                  transition: "width 200ms ease",
                }}
              />
            )}

            {/* Indeterminada (gráficos) */}
            {!hasProgress && (
              <div
                style={{
                  height: "100%",
                  width: "35%",
                  background: "#111",
                  position: "absolute",
                  left: 0,
                  top: 0,
                  borderRadius: 999,
                  animation: "cgim-indeterminate 1.05s ease-in-out infinite",
                }}
              />
            )}
          </div>

          <style>
            {`
              @keyframes cgim-indeterminate {
                0% { transform: translateX(-120%); opacity: 0.6; }
                50% { opacity: 1; }
                100% { transform: translateX(320%); opacity: 0.6; }
              }
            `}
          </style>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Comexsetor • Módulo CGIM</h2>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Visualização hierárquica + gráficos por cesta.
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          {lastUpdated ? (
            <>Atualizado em {lastUpdated.toLocaleString("pt-BR")}</>
          ) : (
            <>—</>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={controlRow}>
          <div>
            <div style={labelStyle}>Entidade</div>
            <select
              value={entity}
              onChange={(e) => {
                setSelectedCategories([]);
                setSelectedSubcategories([]);
                setExpandedIds(new Set());
                setTree([]);
                setDictRowsAll([]);
                setDiagnostics(null);
                setError(null);
                setLastUpdated(null);
                setEntity(e.target.value);
              }}
              style={selectBoxStyle}
            >
              {entities.map((en) => (
                <option key={en} value={en}>
                  {en}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Ano</div>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={selectBoxStyle}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Fluxo</div>
            <select
              value={flow}
              onChange={(e) => setFlow(e.target.value as FlowType)}
              style={selectBoxStyle}
            >
              <option value="import">Importação</option>
              <option value="export">Exportação</option>
            </select>
          </div>

          <div>
            <div style={labelStyle}>Visualização</div>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              style={selectBoxStyle}
            >
              <option value="BOTH">Tabela + Gráficos</option>
              <option value="CHARTS">Somente Gráficos</option>
              <option value="TABLE">Somente Tabela</option>
            </select>
          </div>
        </div>

        <div style={{ height: 12 }} />

        <div style={controlRow}>
          <div>
            <div style={labelStyle}>Nível de desagregação</div>
            <select
              value={detailLevel}
              onChange={(e) => setDetailLevel(e.target.value as DetailLevel)}
              style={selectBoxStyle}
            >
              <option value="CATEGORY">Somente Categoria</option>
              <option value="SUBCATEGORY">Categoria + Subcategoria</option>
              <option value="NCM">Até NCM</option>
            </select>

            {detailLevel !== "CATEGORY" && (
              <div style={{ marginTop: 10 }}>
                <div style={labelStyle}>Profundidade da Subcategoria</div>
                <select
                  value={subcatDepth}
                  onChange={(e) => {
                    setSelectedSubcategories([]);
                    setSubcatDepth(Number(e.target.value));
                  }}
                  style={selectBoxStyle}
                >
                  {Array.from(
                    { length: Math.max(1, maxSubcatDepth) },
                    (_, i) => i + 1
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d === 1 ? "Subcategoria (1)" : `Subcategoria (1…${d})`}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                  Máximo nesta entidade: {maxSubcatDepth}
                </div>
              </div>
            )}
          </div>

          <div>
            <div style={labelStyle}>Total (cesta anual – ano selecionado)</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              FOB: {formatMoneyUS(total.fob)}
            </div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>
              KG: {formatKg(total.kg)}
            </div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>
              US$/t:{" "}
              {formatUsdPerTon(total.kg > 0 ? total.fob / (total.kg / 1000) : 0)}
            </div>

            {diagnostics && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  Diagnóstico
                </div>
                <div>
                  Dicionário: {diagnostics.dictRows} linhas •{" "}
                  {diagnostics.distinctNcms} NCMs únicos
                </div>
                <div>
                  Duplicidades: {diagnostics.duplicateNcms} • Conflitos:{" "}
                  {diagnostics.conflictingMappings}
                </div>
                <div>
                  Comex rows: {diagnostics.comexRows} • Zeradas:{" "}
                  {diagnostics.comexZeroRows}
                </div>
                {diagnostics.apiLikelyDown && (
                  <div>⚠️ API parece ter retornado tudo zero.</div>
                )}
              </div>
            )}
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <div style={labelStyle}>Filtros (definem a cesta dos gráficos)</div>
            <div style={filtersStack}>
              <div>
                <div style={labelStyle}>Filtrar Categorias (multi)</div>
                <select
                  multiple
                  value={selectedCategories}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map(
                      (o) => o.value
                    );
                    setSelectedCategories(values);
                    setSelectedSubcategories([]);
                  }}
                  style={multiSelectStyleBase}
                >
                  {availableCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                  {selectedCategories.length
                    ? `${selectedCategories.length} selecionada(s)`
                    : "Todas"}
                </div>
              </div>

              <div>
                <div style={labelStyle}>Filtrar Subcategorias (multi)</div>
                <select
                  multiple
                  value={selectedSubcategories}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map(
                      (o) => o.value
                    );
                    setSelectedSubcategories(values);
                  }}
                  style={multiSelectSubcatStyle}
                >
                  {availableSubcategories.map((s) => (
                    <option key={s} value={s} title={s}>
                      {truncateLabel(s, 140)}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                  {selectedSubcategories.length
                    ? `${selectedSubcategories.length} selecionada(s)`
                    : "Todas (quando existirem)"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => expandAll()}
                  disabled={!tree.length}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Expandir tudo
                </button>
                <button
                  onClick={() => collapseAll()}
                  disabled={!tree.length}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Recolher tudo
                </button>
                <button
                  onClick={() => resetFilters()}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {(viewMode === "CHARTS" || viewMode === "BOTH") && (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 900 }}>
              Gráficos da cesta (recorte atual)
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {chartsLoading ? "Carregando…" : "OK"}
            </div>
          </div>

          {chartsError && (
            <div style={{ marginBottom: 10, color: "#b00020", fontSize: 13 }}>
              {chartsError}
            </div>
          )}

          {!chartsLoading && !annualSeries.length && (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              Sem dados para gráficos (cesta vazia).
            </div>
          )}

          {!!annualSeries.length && (
            <>
              <SimpleLineChart
                title="Série anual – FOB e KG (cesta agregada)"
                data={annualSeries}
                xAxisKey="name"
                yAxisLabel="FOB / KG"
                lines={[
                  { dataKey: "fob", name: "FOB (US$)", color: "#111" },
                  { dataKey: "kg", name: "KG", color: "#666" },
                ]}
              />

              <SimpleLineChart
                title="Série anual – Preço médio (US$/t)"
                data={annualPriceSeries}
                xAxisKey="name"
                yAxisLabel="US$/t"
                lines={[{ dataKey: "usdPerTon", name: "US$/t", color: "#111" }]}
              />

              <SimpleBarChart
                title="Composição por Categoria (FOB) – Top 20"
                data={categoryBars}
                xAxisKey="name"
                dataKey="fob"
                yAxisLabel="FOB (US$)"
                barName="FOB"
                showLegend={false}
              />

              <SimpleBarChart
                title="Composição por Subcategoria (FOB) – Top 25"
                data={subcatBars}
                xAxisKey="name"
                dataKey="fob"
                yAxisLabel="FOB (US$)"
                barName="FOB"
                showLegend={false}
              />
            </>
          )}
        </div>
      )}

      {(viewMode === "TABLE" || viewMode === "BOTH") && (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 900 }}>Estrutura agregada</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Ordenação: {sortKey.toUpperCase()} ({sortDir})
            </div>
          </div>

          <CgimHierarchyTable
            tree={tree}
            detailLevel={detailLevel}
            selectedCategories={selectedCategories}
            selectedSubcategories={selectedSubcategories}
            expandedIds={expandedIds}
            onToggleExpand={(id) => {
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            sortKey={sortKey}
            sortDir={sortDir}
            onChangeSort={(k) => {
              setSortKey((prevKey) => {
                if (prevKey !== k) {
                  setSortDir("desc");
                  return k;
                }
                setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                return prevKey;
              });
            }}
            formatFOB={formatMoneyUS}
            formatKG={formatKg}
          />
        </div>
      )}
    </div>
  );
}
