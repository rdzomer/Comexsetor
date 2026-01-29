// CgimAnalyticsPage.tsx
// =====================
// MODO 1 — MÍNIMO ABSOLUTO
// Apenas IMPORT, apenas TABELA, apenas 1 ANO
// Zero gráficos, zero séries, zero export
// =====================

import React from "react";
import CgimStickyLoader from "./cgim/CgimStickyLoader";
import CgimControlsPanel from "./cgim/CgimControlsPanel";

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
import { fetchComexYearByNcmList } from "../services/comexApiService";

/* =========================
   Helpers mínimos (inalterados)
========================= */
function normalizeNcm(v: any): string {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.padStart(8, "0").slice(0, 8);
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

export default function CgimAnalyticsPage() {
  /* =========================
     Estado mínimo
  ========================= */
  const [entity, setEntity] = React.useState<string>("");
  const [year, setYear] = React.useState<number>(2024);

  const [cgimActive, setCgimActive] = React.useState(false);

  const [detailLevel, setDetailLevel] =
    React.useState<DetailLevel>("SUBCATEGORY");
  const [subcatDepth, setSubcatDepth] = React.useState<number>(1);

  const [tree, setTree] = React.useState<HierarchyNode[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [dictRowsAll, setDictRowsAll] = React.useState<DictionaryRow[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  /* =========================
     Lock anti-rajada
  ========================= */
  const inFlightRef = React.useRef<string | null>(null);

  /* =========================
     Dicionário
  ========================= */
  const loadDictionary = React.useMemo(() => {
    return cgimDictionaryService.loadCgimDictionaryForEntity;
  }, []);

  /* =========================
     FETCH PRINCIPAL — MODO 1
  ========================= */
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!cgimActive || !entity) return;

      const key = `${entity}|${year}`;
      if (inFlightRef.current === key) return;
      inFlightRef.current = key;

      setLoading(true);
      setError(null);
      setTree([]);
      setLastUpdated(null);

      try {
        const dictEntries = await loadDictionary(entity);

        const dictRowsRaw: DictionaryRow[] = dictEntries
          .map((e: any) => {
            return {
              ncm: normalizeNcm(e.ncm),
              categoria:
                String(e.categoria ?? "").trim() ||
                "Sem categoria (mapeamento incompleto)",
              subcategoria: buildSubcategoryLabel(
                e.subcategorias ?? [],
                subcatDepth
              ),
            };
          })
          .filter((r) => !!r.ncm);

        setDictRowsAll(dictRowsRaw);

        const ncms = Array.from(
          new Set(dictRowsRaw.map((r) => r.ncm))
        );

        setProgress({ done: 0, total: ncms.length });

        const importRows = await fetchComexYearByNcmList({
          year: String(year),
          flow: "import",
          ncms,
          lite: true,
          onProgress: ({ done }) =>
            setProgress({ done, total: ncms.length }),
        });

        if (cancelled) return;

        const comexRows = importRows.map((r: any) => ({
          ncm: normalizeNcm(r.ncm ?? r.coNcm),
          metricFOB: Number(r.fob ?? 0),
          metricKG: Number(r.kg ?? 0),
        }));

        const treeBuilt = buildHierarchyTree({
          dictRows: dictRowsRaw,
          seedRows: dictRowsRaw,
          comexRows,
          includeUnmapped: true,
          seedGroupsFromDictionary: true,
        });

        setTree(treeBuilt);
        setLastUpdated(new Date());
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Erro ao carregar dados.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProgress(null);
          inFlightRef.current = null;
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [cgimActive, entity, year, subcatDepth, loadDictionary]);

  /* =========================
     UI mínima
  ========================= */
  const total = React.useMemo(() => computeTotal(tree), [tree]);
  const categories = React.useMemo(() => listCategories(tree), [tree]);
  const subcategories = React.useMemo(
    () => listSubcategories(tree, []),
    [tree]
  );

  return (
    <div style={{ padding: 18 }}>
      <CgimStickyLoader
        show={loading}
        title="Carregando tabela (Modo 1)…"
        progress={progress}
      />

      <h2>CGIM — Modo 1 (Teste mínimo)</h2>

      {!entity ? (
        <div>Selecione uma entidade para iniciar.</div>
      ) : !cgimActive ? (
        <button
          onClick={() => setCgimActive(true)}
          style={{ padding: 10, marginBottom: 12 }}
        >
          Iniciar análise
        </button>
      ) : null}

      <CgimControlsPanel
        entity={entity}
        entities={["", "IABR", "ABIVIDRO", "ABAL", "IBÁ"]}
        onChangeEntity={(e) => {
          setCgimActive(false);
          setEntity(e);
          setTree([]);
        }}
        year={year}
        years={[2022, 2023, 2024, 2025]}
        onChangeYear={(y) => {
          setCgimActive(false);
          setYear(y);
        }}
        detailLevel={detailLevel}
        onChangeDetailLevel={setDetailLevel}
        subcatDepth={subcatDepth}
        maxSubcatDepth={3}
        onChangeSubcatDepth={setSubcatDepth}
        total={total}
        availableCategories={categories}
        availableSubcategories={subcategories}
        error={error}
      />

      <pre style={{ fontSize: 12, opacity: 0.7 }}>
        Linhas na árvore: {tree.length}
        {"\n"}
        Atualizado em:{" "}
        {lastUpdated ? lastUpdated.toLocaleString("pt-BR") : "—"}
      </pre>
    </div>
  );
}
