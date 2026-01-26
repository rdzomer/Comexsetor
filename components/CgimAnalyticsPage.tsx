// components/CgimAnalyticsPage.tsx
import React from "react";
import Section from "./Section";
import CgimStickyLoader from "./cgim/CgimStickyLoader";
import CgimControlsPanel from "./cgim/CgimControlsPanel";
import CgimAnnualChartsPanel from "./cgim/CgimAnnualChartsPanel";
import SimpleLineChart from "./charts/SimpleLineChart";
import CompositionDonutChart from "./charts/CompositionDonutChart";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ComposedChart,
} from "recharts";

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
function formatUsdPerTonTable(v: number): string {
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


/* ======================================================================================
   CGIM — TABELA HIERÁRQUICA (INLINE)
   Escopo: apenas EXIBIÇÃO da tabela (sem mexer em API/services/cálculos).
   Mantém: hierarquia, colunas fixas à esquerda, rolagem horizontal, cores saldo +/-
   Adiciona colunas: EXP (FOB/KG), IMP (FOB/KG), BALANÇA (FOB/KG), PM IMP/EXP (US$/t)
====================================================================================== */

type TableSortKey = "fob" | "kg";
type TableSortDir = "asc" | "desc";

type CgimHierarchyTableProps = {
  tree: any[]; // HierarchyNode[] (mantido como any para evitar refatorações / dependências circulares)
  detailLevel: any; // DetailLevel
  selectedCategories: string[];
  selectedSubcategories: string[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  sortKey: TableSortKey;
  sortDir: TableSortDir;
  onChangeSort: (k: TableSortKey) => void;
  formatFOB: (v: number) => string;
  formatKG: (v: number) => string;
  formatUsdPerTon?: (v: number) => string;
};

function pickNumber(obj: any, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return undefined;
}


function balanceStyle(v?: number): React.CSSProperties {
  if (v === null || v === undefined || Number.isNaN(v)) return {};
  if (v > 0) return { color: "#0E7A2F", fontWeight: 700 };
  if (v < 0) return { color: "#B42318", fontWeight: 700 };
  return { color: "#111827", fontWeight: 700 };
}

function nodeId(n: any): string {
  return String(n?.id ?? n?.key ?? n?.code ?? n?.ncm ?? n?.name ?? Math.random());
}

function nodeLabel(n: any): string {
  return String(n?.label ?? n?.name ?? n?.title ?? n?.ncm ?? "—");
}

function nodeSecondary(n: any): string | undefined {
  const d = n?.description ?? n?.desc ?? n?.secondary;
  return typeof d === "string" ? d : undefined;
}

function nodeChildren(n: any): any[] {
  return (n?.children ?? n?.subcategories ?? n?.items ?? []) as any[];
}

function metric(obj: any) {
  // IMPORTANT: NÃO CALCULA dados-base; apenas lê campos já existentes.
  // Para tabela analítica (merge), preferimos: obj.imp / obj.exp (cada um com {fob, kg})
  const impObj = obj?.imp ?? obj?.import ?? null;
  const expObj = obj?.exp ?? obj?.export ?? null;

  const impFob = pickNumber(impObj, ["fob", "impFob", "importFob", "metricFOB", "fobImp"]) ?? pickNumber(obj?.metrics ?? obj, ["fob", "impFob", "importFob"]);
  const impKg  = pickNumber(impObj, ["kg", "impKg", "importKg", "metricKG", "kgImp"]) ?? pickNumber(obj?.metrics ?? obj, ["kg", "impKg", "importKg"]);

  const expFob = pickNumber(expObj, ["fob", "expFob", "exportFob", "metricFOB", "fobExp"]);
  const expKg  = pickNumber(expObj, ["kg", "expKg", "exportKg", "metricKG", "kgExp"]);

  // Saldo: se existir pronto, usa; senão deriva (somente exibição)
  const balFob = pickNumber(obj, ["balanceFob", "balFob", "saldoFob", "balance_fob", "saldo_fob"]) ?? (
    (typeof expFob === "number" && typeof impFob === "number") ? (expFob - impFob) : undefined
  );
  const balKg  = pickNumber(obj, ["balanceKg", "balKg", "saldoKg", "balance_kg", "saldo_kg"]) ?? (
    (typeof expKg === "number" && typeof impKg === "number") ? (expKg - impKg) : undefined
  );

  // Preço médio (US$/t): se existir pronto, usa; senão deriva (somente exibição)
  const pmImp = pickNumber(obj, ["avgImpUsdPerTon", "pmImpUsdPerTon", "avgImportUsdPerTon", "pmImportUsdPerTon"]);
  const pmExp = pickNumber(obj, ["avgExpUsdPerTon", "pmExpUsdPerTon", "avgExportUsdPerTon", "pmExportUsdPerTon"]);

  const pmImpDerived =
    pmImp !== undefined ? pmImp :
    (typeof impFob === "number" && typeof impKg === "number" && impKg > 0 ? (impFob * 1000) / impKg : undefined);

  const pmExpDerived =
    pmExp !== undefined ? pmExp :
    (typeof expFob === "number" && typeof expKg === "number" && expKg > 0 ? (expFob * 1000) / expKg : undefined);

  return { expFob, expKg, impFob, impKg, balFob, balKg, pmImp: pmImpDerived, pmExp: pmExpDerived };
}

function CgimHierarchyTable(props: CgimHierarchyTableProps) {
  const {
    tree,
    expandedIds,
    onToggleExpand,
    sortKey,
    sortDir,
    onChangeSort,
    formatFOB,
    formatKG,
    formatUsdPerTon,
  } = props;

  const styles: Record<string, React.CSSProperties> = {
    wrap: {
      border: "1px solid #E6E8EC",
      borderRadius: 14,
      background: "#fff",
      overflow: "hidden",
    },
    tableWrap: { overflowX: "auto" },
    table: {
      width: "100%",
      borderCollapse: "separate",
      borderSpacing: 0,
      minWidth: 1250,
      fontSize: 13,
    },
    theadTh: {
      position: "sticky",
      top: 0,
      zIndex: 4,
      background: "#F9FAFB",
      borderBottom: "1px solid #E6E8EC",
      padding: "10px 10px",
      textAlign: "right",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    theadThLeft: {
      position: "sticky",
      top: 0,
      left: 0,
      zIndex: 6,
      background: "#F9FAFB",
      borderBottom: "1px solid #E6E8EC",
      padding: "10px 10px",
      textAlign: "left",
      fontWeight: 800,
      whiteSpace: "nowrap",
    },
    groupHead: {
      background: "#F9FAFB",
      borderBottom: "1px solid #E6E8EC",
      padding: "8px 10px",
      textAlign: "center",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },
    groupHeadLeft: {
      position: "sticky",
      left: 0,
      zIndex: 6,
      background: "#F9FAFB",
      borderBottom: "1px solid #E6E8EC",
      padding: "8px 10px",
      textAlign: "left",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },
    td: {
      borderBottom: "1px solid #F1F2F4",
      padding: "10px 10px",
      textAlign: "right",
      whiteSpace: "nowrap",
      color: "#111827",
    },
    tdLeft: {
      position: "sticky",
      left: 0,
      zIndex: 3,
      background: "#fff",
      borderBottom: "1px solid #F1F2F4",
      padding: "10px 10px",
      textAlign: "left",
      whiteSpace: "nowrap",
    },
    btn: {
      border: "1px solid #E6E8EC",
      background: "#fff",
      borderRadius: 10,
      width: 24,
      height: 24,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      marginRight: 8,
      userSelect: "none",
    },
    sub: { color: "#6B7280", fontSize: 12, marginTop: 2, maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis" },
    rowCat: { fontWeight: 800 },
    rowSub: { fontWeight: 700 },
    rowNcm: { fontWeight: 500 },
    sortBtn: {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      padding: 0,
      fontWeight: 800,
      color: "#111827",
    },
  };

  function chevron(open: boolean) {
    return open ? "▾" : "▸";
  }

  function indent(depth: number): React.CSSProperties {
    return { paddingLeft: 10 + depth * 18 };
  }

  function flatten(nodes: any[], depth: number, kind: "category" | "subcategory" | "ncm", acc: any[]) {
    // Ordenação: mantém lógica original de sortKey/sortDir (aplicada no nível atual)
    const sorted = [...nodes].sort((a, b) => {
      const ma = metric(a);
      const mb = metric(b);
      const va = sortKey === "fob" ? (ma.impFob ?? 0) : (ma.impKg ?? 0);
      const vb = sortKey === "fob" ? (mb.impFob ?? 0) : (mb.impKg ?? 0);
      const diff = va - vb;
      return sortDir === "asc" ? diff : -diff;
    });

    for (const n of sorted) {
      const id = nodeId(n);
      const kids = nodeChildren(n);
      const open = expandedIds.has(id);

      acc.push({ n, id, depth, kind, hasChildren: kids.length > 0, open });

      if (kids.length > 0 && open) {
        const nextKind = kind === "category" ? "subcategory" : kind === "subcategory" ? "ncm" : "ncm";
        flatten(kids, depth + 1, nextKind, acc);
      }
    }
  }

  const rows = React.useMemo(() => {
    const acc: any[] = [];
    flatten(tree ?? [], 0, "category", acc);
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, expandedIds, sortKey, sortDir]);

  const sortLabel = sortKey === "fob" ? "FOB" : "KG";

  return (
    <div style={styles.wrap}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #E6E8EC", display: "flex", gap: 14, alignItems: "center" }}>
        <div style={{ fontWeight: 900, color: "#111827" }}>Tabela</div>
        <div style={{ fontSize: 12, color: "#6B7280" }}>
          Ordenação:{" "}
          <button style={styles.sortBtn} onClick={() => onChangeSort(sortKey)} title="Alternar direção">
            {sortLabel} ({sortDir})
          </button>
          {" · "}
          <button style={styles.sortBtn} onClick={() => onChangeSort(sortKey === "fob" ? "kg" : "fob")} title="Trocar chave de ordenação">
            trocar para {sortKey === "fob" ? "KG" : "FOB"}
          </button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.groupHeadLeft}>Hierarquia</th>
              <th style={styles.groupHead} colSpan={2}>EXP</th>
              <th style={styles.groupHead} colSpan={2}>IMP</th>
              <th style={styles.groupHead} colSpan={2}>BALANÇA</th>
              <th style={styles.groupHead} colSpan={2}>PREÇO MÉDIO (US$/t)</th>
            </tr>
            <tr>
              <th style={styles.theadThLeft}>Categoria / Subcategoria / NCM</th>

              <th style={styles.theadTh} title="Exportação (US$ FOB)">EXP (US$ FOB)</th>
              <th style={styles.theadTh} title="Exportação (KG)">EXP (KG)</th>

              <th style={styles.theadTh} title="Importação (US$ FOB)">IMP (US$ FOB)</th>
              <th style={styles.theadTh} title="Importação (KG)">IMP (KG)</th>

              <th style={styles.theadTh} title="Saldo comercial (US$ FOB)">BALANÇA (FOB)</th>
              <th style={styles.theadTh} title="Saldo comercial (KG)">BALANÇA (KG)</th>

              <th style={styles.theadTh} title="Preço médio de importação (US$/t)">PM IMP (US$/t)</th>
              <th style={styles.theadTh} title="Preço médio de exportação (US$/t)">PM EXP (US$/t)</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 16, color: "#6B7280" }}>Nenhum dado para exibir.</td>
              </tr>
            ) : (
              rows.map((r) => {
                const m = metric(r.n);

                const label = nodeLabel(r.n);
                const secondary = nodeSecondary(r.n);

                const trStyle =
                  r.kind === "category" ? styles.rowCat : r.kind === "subcategory" ? styles.rowSub : styles.rowNcm;

                return (
                  <tr key={r.id} style={trStyle}>
                    <td style={{ ...styles.tdLeft, ...indent(r.depth) }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        {r.hasChildren ? (
                          <button
                            type="button"
                            style={styles.btn}
                            onClick={() => onToggleExpand(r.id)}
                            aria-label={r.open ? "Recolher" : "Expandir"}
                            title={r.open ? "Recolher" : "Expandir"}
                          >
                            {chevron(r.open)}
                          </button>
                        ) : (
                          <span style={{ width: 24, display: "inline-block" }} />
                        )}

                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ color: "#111827" }}>{label}</span>
                          {secondary ? <span style={styles.sub} title={secondary}>{secondary}</span> : null}
                        </div>
                      </div>
                    </td>

                    {/* EXP */}
                    <td style={styles.td}>{m.expFob === undefined ? "—" : formatFOB(m.expFob)}</td>
                    <td style={styles.td}>{m.expKg === undefined ? "—" : formatKG(m.expKg)}</td>

                    {/* IMP */}
                    <td style={styles.td}>{m.impFob === undefined ? "—" : formatFOB(m.impFob)}</td>
                    <td style={styles.td}>{m.impKg === undefined ? "—" : formatKG(m.impKg)}</td>

                    {/* BALANÇA */}
                    <td style={{ ...styles.td, ...balanceStyle(m.balFob) }}>{m.balFob === undefined ? "—" : formatFOB(m.balFob)}</td>
                    <td style={{ ...styles.td, ...balanceStyle(m.balKg) }}>{m.balKg === undefined ? "—" : formatKG(m.balKg)}</td>

                    {/* PREÇO MÉDIO */}
                    <td style={styles.td}>{m.pmImp === undefined ? "—" : formatUsdPerTonTable(m.pmImp)}</td>
                    <td style={styles.td}>{m.pmExp === undefined ? "—" : formatUsdPerTonTable(m.pmExp)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ======================================================================================
   CGIM — MERGE DE ÁRVORES (IMPORT + EXPORT) PARA TABELA
   - Não altera services. Apenas combina duas árvores já agregadas.
   - A tabela passa a ler: node.imp.{fob,kg} e node.exp.{fob,kg}
====================================================================================== */
function indexTreeById(nodes: any[], map = new Map<string, any>()) {
  for (const n of nodes || []) {
    const id = String(n?.id ?? n?.key ?? n?.code ?? n?.ncm ?? n?.name);
    map.set(id, n);
    const kids = (n?.children ?? n?.subcategories ?? n?.items ?? []) as any[];
    if (kids?.length) indexTreeById(kids, map);
  }
  return map;
}

function cloneNodeShallow(n: any) {
  // clone raso preservando tudo (evita regressões de UI)
  return { ...n };
}

function mergeImpExpTrees(importTree: any[], exportTree: any[]) {
  const expIndex = indexTreeById(exportTree || []);
  const mergeNode = (nImp: any): any => {
    const id = String(nImp?.id ?? nImp?.key ?? nImp?.code ?? nImp?.ncm ?? nImp?.name);
    const nExp = expIndex.get(id);

    const out = cloneNodeShallow(nImp);

    // Preserva metrics originais (usadas em outros lugares). Adiciona canais "imp" e "exp" para tabela.
    out.imp = {
      fob: nImp?.metrics?.fob ?? nImp?.fob ?? 0,
      kg: nImp?.metrics?.kg ?? nImp?.kg ?? 0,
    };

    out.exp = {
      fob: nExp?.metrics?.fob ?? nExp?.fob ?? 0,
      kg: nExp?.metrics?.kg ?? nExp?.kg ?? 0,
    };

    const kidsImp = (nImp?.children ?? nImp?.subcategories ?? nImp?.items ?? []) as any[];
    if (kidsImp?.length) {
      out.children = kidsImp.map(mergeNode);
    }

    return out;
  };

  return (importTree || []).map(mergeNode);
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
  const [tableTree, setTableTree] = React.useState<any[]>([]);
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
  // ✅ séries anuais separadas (padrão NCM: import/export separados)
  const [annualImportSeries, setAnnualImportSeries] = React.useState<any[]>([]);
  const [annualExportSeries, setAnnualExportSeries] = React.useState<any[]>([]);
  const [annualBalanceSeries, setAnnualBalanceSeries] = React.useState<any[]>([]);
  const [annualPriceIeSeries, setAnnualPriceIeSeries] = React.useState<any[]>([]);
  const [annualPriceSeries, setAnnualPriceSeries] = React.useState<any[]>([]);
  const [categoryBars, setCategoryBars] = React.useState<any[]>([]);
  const [subcatBars, setSubcatBars] = React.useState<any[]>([]);
  const [categoryBarsKg, setCategoryBarsKg] = React.useState<any[]>([]);
  const [subcatBarsKg, setSubcatBarsKg] = React.useState<any[]>([]);
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
    setTableTree([]);
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

        const autoLite = Boolean(import.meta.env.PROD) || ncmsAllUnique.length > 120;

        const [basketImportRows, basketExportRows]: [CgimAnnualBasketRow[], CgimAnnualBasketRow[]] =
          await Promise.all([
            fetchAnnualBasketByNcm({
              year: String(year),
              flow: "import",
              ncms: ncmsAllUnique,
              lite: autoLite,
              chunkSize: autoLite ? 20 : 60,
              concurrency: autoLite ? 1 : 2,
              onProgress: (info) => {
                if (!cancelled) setProgress(info);
              },
            }),
            fetchAnnualBasketByNcm({
              year: String(year),
              flow: "export",
              ncms: ncmsAllUnique,
              lite: autoLite,
              chunkSize: autoLite ? 20 : 60,
              concurrency: autoLite ? 1 : 2,
              // não precisa progredir 2x; mantém o mesmo callback
              onProgress: (info) => {
                if (!cancelled) setProgress(info);
              },
            }),
          ]);

        if (cancelled) return;

        const comexRowsImport = basketImportRows.map((r) => ({
          ncm: r.ncm,
          metricFOB: r.fob,
          metricKG: r.kg,
        }));

        const comexRowsExport = basketExportRows.map((r) => ({
          ncm: r.ncm,
          metricFOB: r.fob,
          metricKG: r.kg,
        }));

        // Mantém compatibilidade: comexRows "principal" segue o flow selecionado (para não quebrar o resto)
        const comexRows = (flow === "export" ? comexRowsExport : comexRowsImport);

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
        const importTree = buildHierarchyTree({
          dictRows: dictRowsDedup,
          seedRows: dictRowsRawAll,
          comexRows: comexRowsImport,
          includeUnmapped: true,
          includeAllZero: apiLikelyDown,
          seedGroupsFromDictionary: true,
          includeZeroLeaves: false,
        });

        const exportTree = buildHierarchyTree({
          dictRows: dictRowsDedup,
          seedRows: dictRowsRawAll,
          comexRows: comexRowsExport,
          includeUnmapped: true,
          includeAllZero: apiLikelyDown,
          seedGroupsFromDictionary: true,
          includeZeroLeaves: false,
        });

        // árvore principal (mantém comportamento atual do módulo)
        setTree(flow === "export" ? exportTree : importTree);

        // árvore combinada para tabela analítica (IMP + EXP)
        setTableTree(mergeImpExpTrees(importTree, exportTree));
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

    const t = window.setTimeout(() => {
      if (!cancelled) run();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
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
          setCategoryBarsKg([]);
          setSubcatBarsKg([]);
        setCategoryBarsKg([]);
        setSubcatBarsKg([]);
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

        const yearStart = 2010;
        const yearEnd = 2025;

        // ✅ Padrão NCM: séries anuais separadas para Importação e Exportação
        const [impSeriesRaw, expSeriesRaw] = await Promise.all([
          fetchBasketAnnualSeries({
            flow: "import",
            yearStart,
            yearEnd,
            ncms,
            useCache: true,
            cacheTtlHours: 24,
          }),
          fetchBasketAnnualSeries({
            flow: "export",
            yearStart,
            yearEnd,
            ncms,
            useCache: true,
            cacheTtlHours: 24,
          }),
        ]);

        if (cancelled) return;

        const impSeries = impSeriesRaw.map((p) => ({
          name: String(p.year),
          fob: p.fob,
          kg: p.kg,
          usdPerTon: p.usdPerTon,
        }));
        const expSeries = expSeriesRaw.map((p) => ({
          name: String(p.year),
          fob: p.fob,
          kg: p.kg,
          usdPerTon: p.usdPerTon,
        }));

        // Mantém annualSeries (legado) como importação para não quebrar usos existentes
        setAnnualSeries(impSeries.map((p) => ({ name: p.name, fob: p.fob, kg: p.kg })));
        setAnnualImportSeries(impSeries.map((p) => ({ name: p.name, fob: p.fob, kg: p.kg })));
        setAnnualExportSeries(expSeries.map((p) => ({ name: p.name, fob: p.fob, kg: p.kg })));

        // Preço médio: Importação vs Exportação no mesmo dataset por ano
        const byYear = new Map<string, { importPrice?: number; exportPrice?: number; importFob?: number; exportFob?: number }>();
        for (const p of impSeries) {
          byYear.set(p.name, { ...(byYear.get(p.name) || {}), importPrice: p.usdPerTon, importFob: p.fob });
        }
        for (const p of expSeries) {
          byYear.set(p.name, { ...(byYear.get(p.name) || {}), exportPrice: p.usdPerTon, exportFob: p.fob });
        }
        const yearsSorted = Array.from(byYear.keys()).sort((a, b) => Number(a) - Number(b));

        const priceIE = yearsSorted.map((y) => ({
          name: y,
          importPrice: byYear.get(y)?.importPrice ?? 0,
          exportPrice: byYear.get(y)?.exportPrice ?? 0,
        }));
        setAnnualPriceIeSeries(priceIE);
        // Mantém annualPriceSeries (legado) apontando para a mesma série (não quebra)
        setAnnualPriceSeries(priceIE.map((p) => ({ name: p.name, usdPerTon: p.importPrice })));

        const balance = yearsSorted.map((y) => {
          const ex = byYear.get(y)?.exportFob ?? 0;
          const im = byYear.get(y)?.importFob ?? 0;
          return { name: y, exportFob: ex, importFob: im, balanceFob: ex - im };
        });
        setAnnualBalanceSeries(balance);

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

        const catsKg: any[] = [];
        for (const cat of tree) {
          if (catSet.size && !catSet.has(cat.name)) continue;
          catsKg.push({ name: cat.name, kg: cat.metrics.kg });
        }
        catsKg.sort((a, b) => (b.kg || 0) - (a.kg || 0));
        setCategoryBarsKg(catsKg.slice(0, 20));

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

        const subsKg: any[] = [];
        for (const cat of tree) {
          if (catSet.size && !catSet.has(cat.name)) continue;
          for (const sub of cat.children || []) {
            if (sub.level !== "subcategory") continue;
            if (subSet.size && !subSet.has(sub.name)) continue;
            subsKg.push({
              name: `${cat.name} • ${sub.name}`,
              kg: sub.metrics.kg,
            });
          }
        }
        subsKg.sort((a, b) => (b.kg || 0) - (a.kg || 0));
        setSubcatBarsKg(subsKg.slice(0, 25));
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

  // Rodapé padrão (igual ao módulo NCM)
  const sourceFooterStyle: React.CSSProperties = {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.7,
    textAlign: "center",
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
  const showTopLoading = chartsLoading;
  const topLoadingTitle = loading ? "Carregando tabela…" : "Carregando gráficos…";
  const hasProgress = !!(progress && progress.total);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, Math.round((progress!.done / progress!.total) * 100)))
    : 0;


  // ✅ Identificador curto da cesta atual (para títulos dos gráficos)
  const basketLabel = React.useMemo(() => {
    const cats = (selectedCategories || []).filter(Boolean);
    const subs = (selectedSubcategories || []).filter(Boolean);

    const fmtList = (arr: string[], max = 3) => {
      if (!arr.length) return "Todas";
      const head = arr.slice(0, max).join(", ");
      const tail = arr.length > max ? ` +${arr.length - max}` : "";
      return head + tail;
    };

    const catLabel = fmtList(cats, 3);
    const subLabel = fmtList(subs, 2);
    return subs.length ? `${entity} • ${catLabel} • ${subLabel}` : `${entity} • ${catLabel}`;
  }, [entity, selectedCategories, selectedSubcategories]);

  // ✅ Série derivada para a balança: importações negativas (para ficar abaixo do eixo zero)
  // (Não altera a lógica de dados — apenas a representação visual no gráfico.)
  const annualBalanceSeriesSigned = React.useMemo(() => {
    return (annualBalanceSeries || []).map((d) => ({
      ...d,
      exportFobPos: Math.abs(Number((d as any).exportFob ?? 0)),
      importFobNeg: -Math.abs(Number((d as any).importFob ?? 0)),
    }));
  }, [annualBalanceSeries]);

  // ✅ Domínio simétrico em torno de zero, para o gráfico de balança (barras + linha)
  const balanceMaxAbs = React.useMemo(() => {
    let max = 0;
    for (const d of annualBalanceSeriesSigned) {
      const a = Math.abs(Number((d as any).exportFobPos ?? 0));
      const b = Math.abs(Number((d as any).importFobNeg ?? 0));
      const c = Math.abs(Number((d as any).balanceFob ?? 0));
      max = Math.max(max, a, b, c);
    }
    if (!Number.isFinite(max) || max <= 0) return 1;
    return max * 1.15;
  }, [annualBalanceSeriesSigned]);


  const tickFob = React.useCallback((v: any) => formatMoneyUS(Number(v) || 0), []);
  const tickKg = React.useCallback((v: any) => formatKg(Number(v) || 0), []);
  const tickPrice = React.useCallback((v: any) => formatUsdPerTonTable(Number(v) || 0), []);

  // Aliases/formatters (mantém compatibilidade com o painel extraído)
  const tickUsd = tickFob;
  const tickUsdPerTon = tickPrice;
  const tickUsdSigned = React.useCallback((v: any) => {
    const n = Number(v) || 0;
    const sign = n < 0 ? "-" : "";
    return sign + formatMoneyUS(Math.abs(n));
  }, []);


// Textos explicativos (condensados) — lembrando que este módulo é sempre por ENTIDADE.
// As "categorias" e "subcategorias" aqui são agrupamentos internos da cesta daquela entidade (e podem variar por entidade).
const compositionCategoryTextFob =
  "Mostra como o valor FOB total da cesta da entidade se distribui entre as categorias internas mapeadas no dicionário (por exemplo, famílias/linhas de produtos dentro daquela entidade). Ajuda a identificar rapidamente onde está a concentração do valor, se existe dependência de poucos grupos e quais categorias são residuais — útil para diagnósticos setoriais e priorização de análises.";

const compositionSubcategoryTextFob =
  "Mostra como o valor FOB total da cesta da entidade se distribui entre as subcategorias internas (níveis abaixo das categorias, quando existirem). Ajuda a enxergar quais segmentos específicos sustentam o valor, se há concentração em um único subconjunto e quais subcategorias relevantes ficam escondidas quando olhamos só a categoria — útil para direcionar investigações e recortes mais finos por NCM.";

const compositionCategoryTextKg =
  "Mostra como o volume (KG) total da cesta da entidade se distribui entre as categorias internas mapeadas no dicionário. Ajuda a identificar quais grupos concentram o volume, se existe dependência de poucos itens e quais categorias são residuais — útil para análises de escala, capacidade e exposição por volume.";

const compositionSubcategoryTextKg =
  "Mostra como o volume (KG) total da cesta da entidade se distribui entre as subcategorias internas (níveis abaixo das categorias, quando existirem). Ajuda a enxergar quais segmentos concentram o volume, se há concentração em um único subconjunto e quais subcategorias relevantes ficam escondidas quando olhamos só a categoria — útil para direcionar investigações e recortes mais finos por NCM.";

  return (
    <>
      <style>{`
        .cgimAnnualGrid2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          align-items: stretch;
        }
        @media (max-width: 1100px) {
          .cgimAnnualGrid2 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    <div
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* Loader sticky (extraído) */}
      <CgimStickyLoader
        show={showTopLoading}
        title={topLoadingTitle}
        progress={progress}
        cardStyle={cardStyle}
      />

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
            <span>Atualizado em {lastUpdated.toLocaleString("pt-BR")}</span>
          ) : (
            <span>—</span>
          )}
        </div>
      </div>

      {/* Painel de controles (extraído) */}
      {/* Painel de controles (extraído) */}
<CgimControlsPanel
  cardStyle={cardStyle}
  labelStyle={labelStyle}
  selectBoxStyle={selectBoxStyle}
  multiSelectStyleBase={multiSelectStyleBase}
  multiSelectSubcatStyle={multiSelectSubcatStyle}

  entity={entity}
  entities={entities}
  onChangeEntity={(next) => {
    setSelectedCategories([]);
    setSelectedSubcategories([]);
    setExpandedIds(new Set());
    setTree([]);
    setTableTree([]);
    setDictRowsAll([]);
    setDiagnostics(null);
    setError(null);
    setLastUpdated(null);
    setEntity(next);
  }}

  year={year}
  years={years}
  onChangeYear={(next) => setYear(next)}

  flow={flow}
  onChangeFlow={(next) => setFlow(next)}

  viewMode={viewMode}
  onChangeViewMode={(next) => setViewMode(next)}

  detailLevel={detailLevel as any}
  onChangeDetailLevel={(next) => setDetailLevel(next as any)}

  subcatDepth={subcatDepth}
  maxSubcatDepth={maxSubcatDepth}
  onChangeSubcatDepth={(next) => {
    setSelectedSubcategories([]);
    setSubcatDepth(next);
  }}

  total={total}
  formatFOB={formatMoneyUS}
  formatKG={formatKg}
  formatUsdPerTon={formatUsdPerTonTable}

  diagnostics={diagnostics as any}

  availableCategories={availableCategories}
  availableSubcategories={availableSubcategories}

  selectedCategories={selectedCategories}
  selectedSubcategories={selectedSubcategories}
  onChangeSelectedCategories={(next) => {
    setSelectedCategories(next);
    setSelectedSubcategories([]);
  }}
  onChangeSelectedSubcategories={(next) => setSelectedSubcategories(next)}

  onExpandAll={() => expandAll()}
  onCollapseAll={() => collapseAll()}
  onResetFilters={() => resetFilters()}

  error={error}
  truncateLabel={truncateLabel}
/>
{/* Gráficos anuais + composição (extraído) */}
      <CgimAnnualChartsPanel
        cardStyle={cardStyle}
        sourceFooterStyle={sourceFooterStyle}
        basketLabel={basketLabel}
        chartsLoading={chartsLoading}
        chartsError={chartsError}
        annualImportSeries={annualImportSeries}
        annualExportSeries={annualExportSeries}
        annualPriceIeSeries={annualPriceIeSeries}
        annualBalanceSeriesSigned={annualBalanceSeriesSigned}
        balanceMaxAbs={balanceMaxAbs}
        tickKg={tickKg}
        tickFob={tickFob}
        tickPrice={tickPrice}
        categoryBars={categoryBars}
        subcatBars={subcatBars}
        categoryBarsKg={categoryBarsKg}
        subcatBarsKg={subcatBarsKg}
        compositionCategoryTextFob={compositionCategoryTextFob}
        compositionSubcategoryTextFob={compositionSubcategoryTextFob}
        compositionCategoryTextKg={compositionCategoryTextKg}
        compositionSubcategoryTextKg={compositionSubcategoryTextKg}
      />


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
            tree={tableTree}
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
    </>
  );
}