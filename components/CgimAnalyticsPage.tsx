// components/CgimAnalyticsPage.tsx
import React from "react";
import { CgimHierarchyTable } from "./CgimHierarchyTable";
import {
  buildHierarchyTree,
  computeTotal,
  listCategories,
  listSubcategories,
  type DetailLevel,
  type DictionaryRow,
  type HierarchyNode,
} from "../utils/cgimAggregation";

// Seus services reais:
import * as cgimDictionaryService from "../services/cgimDictionaryService";
import { fetchAnnualBasketByNcm, type CgimAnnualBasketRow } from "../services/cgimBasketComexService";

type SortKey = "fob" | "kg";
type SortDir = "asc" | "desc";

// O seu FlowType real (pelo service): "import" | "export"
type FlowType = "import" | "export";

function formatMoneyUS(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}
function formatKg(v: number): string {
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
    `Não encontrei função no cgimDictionaryService. Exporte uma destas: ${names.join(", ")}`
  );
}

export default function CgimAnalyticsPage() {
  // Controles principais
  const [entity, setEntity] = React.useState<string>("IABR");
  const [year, setYear] = React.useState<number>(2024);
  const [flow, setFlow] = React.useState<FlowType>("import");

  // Nível de detalhe
  const [detailLevel, setDetailLevel] = React.useState<DetailLevel>("SUBCATEGORY");

  // Ordenação
  const [sortKey, setSortKey] = React.useState<SortKey>("fob");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  // Expand/Collapse
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  // Filtros
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);
  const [selectedSubcategories, setSelectedSubcategories] = React.useState<string[]>([]);

  // Dados e estado
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [tree, setTree] = React.useState<HierarchyNode[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  // Lista fixa de entidades/anos (você pode trocar depois por algo dinâmico)
  const entities = React.useMemo(() => ["IABR", "ABIVIDRO", "ABAL", "IBÁ"], []);
  const years = React.useMemo(() => [2022, 2023, 2024, 2025], []);

  // Resolve a função real do dicionário (sem “chute” de nome fixo)
  const loadDictionary = React.useMemo(() => {
    return pickFn<(entity: string) => Promise<DictionaryRow[]>>(
      cgimDictionaryService,
      [
        "loadCgimDictionaryForEntity",
        "loadDictionaryForEntity",
        "getCgimDictionaryForEntity",
        "getDictionaryForEntity",
      ]
    );
  }, []);

  // Carregamento principal (dict -> ncms -> comex -> árvore)
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        // 1) Dicionário da entidade
        const dictRows = await loadDictionary(entity);

        // 2) Extrai NCMs da cesta (8 dígitos)
        const ncms = Array.from(
          new Set(dictRows.map((r) => normalizeNcm((r as any).ncm)).filter(Boolean))
        );

        // 3) Busca Comex por chunks (o seu service já faz cache e concorrência)
        const basketRows: CgimAnnualBasketRow[] = await fetchAnnualBasketByNcm({
          entity,
          year: String(year),
          flow,
          ncms,
          chunkSize: 60,
          concurrency: 2,
          onProgress: (info) => {
            if (!cancelled) setProgress(info);
          },
        });

        if (cancelled) return;

        // 4) Converte {fob,kg} -> {metricFOB, metricKG} (formato esperado pelo agregador)
        const comexRows = basketRows.map((r) => ({
          ncm: r.ncm,
          metricFOB: r.fob,
          metricKG: r.kg,
        }));

        // 5) Build da árvore
        const nextTree = buildHierarchyTree({
          dictRows,
          comexRows,
          includeUnmapped: true,
        });

        setTree(nextTree);
        setLastUpdated(new Date());

        // começa recolhido (UX melhor)
        setExpandedIds(new Set());

        // saneia filtros antigos
        const availableCats = new Set(listCategories(nextTree));
        const nextSelectedCats = selectedCategories.filter((c) => availableCats.has(c));
        setSelectedCategories(nextSelectedCats);

        const availableSubs = new Set(listSubcategories(nextTree, nextSelectedCats));
        const nextSelectedSubs = selectedSubcategories.filter((s) => availableSubs.has(s));
        setSelectedSubcategories(nextSelectedSubs);
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
  }, [entity, year, flow]);

  // Derivados para filtros
  const availableCategories = React.useMemo(() => listCategories(tree), [tree]);
  const availableSubcategories = React.useMemo(
    () => listSubcategories(tree, selectedCategories),
    [tree, selectedCategories]
  );

  // Totais
  const total = React.useMemo(() => computeTotal(tree), [tree]);

  // Ações
  const onToggleExpand = React.useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onChangeSort = React.useCallback((k: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey !== k) {
        setSortDir("desc");
        return k;
      }
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return prevKey;
    });
  }, []);

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

  // Layout simples
  const cardStyle: React.CSSProperties = {
    border: "1px solid #e6e6e6",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.7, marginBottom: 6 };
  const controlRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 };
  const controlRow2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 };

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Comexsetor • Módulo CGIM</h2>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Visualização hierárquica com controles de desagregação e filtros.
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          {lastUpdated ? <>Atualizado em {lastUpdated.toLocaleString("pt-BR")}</> : <>—</>}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={controlRow}>
          <div>
            <div style={labelStyle}>Entidade</div>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            >
              {entities.map((en) => (
                <option key={en} value={en}>{en}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Ano</div>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Fluxo</div>
            <select
              value={flow}
              onChange={(e) => setFlow(e.target.value as FlowType)}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            >
              <option value="import">Importação</option>
              <option value="export">Exportação</option>
            </select>
          </div>

          <div>
            <div style={labelStyle}>Nível de desagregação</div>
            <select
              value={detailLevel}
              onChange={(e) => setDetailLevel(e.target.value as DetailLevel)}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            >
              <option value="CATEGORY">Somente Categoria</option>
              <option value="SUBCATEGORY">Categoria + Subcategoria</option>
              <option value="NCM">Até NCM</option>
            </select>
          </div>
        </div>

        <div style={{ height: 12 }} />

        <div style={controlRow2}>
          <div>
            <div style={labelStyle}>Filtrar Categorias (multi)</div>
            <select
              multiple
              value={selectedCategories}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                setSelectedCategories(values);
                setSelectedSubcategories([]);
              }}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", minHeight: 120 }}
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
              {selectedCategories.length ? `${selectedCategories.length} selecionada(s)` : "Todas"}
            </div>
          </div>

          <div>
            <div style={labelStyle}>Filtrar Subcategorias (multi)</div>
            <select
              multiple
              value={selectedSubcategories}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                setSelectedSubcategories(values);
              }}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", minHeight: 120 }}
            >
              {availableSubcategories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
              {selectedSubcategories.length ? `${selectedSubcategories.length} selecionada(s)` : "Todas (quando existirem)"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={labelStyle}>Ações</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={expandAll}
                  disabled={!tree.length}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
                >
                  Expandir tudo
                </button>
                <button
                  onClick={collapseAll}
                  disabled={!tree.length}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
                >
                  Recolher tudo
                </button>
                <button
                  onClick={resetFilters}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
                >
                  Limpar filtros
                </button>
              </div>
            </div>

            <div style={{ marginTop: "auto", borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Total (cesta anual)</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                FOB: {formatMoneyUS(total.fob)}
              </div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>
                KG: {formatKg(total.kg)}
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
            Carregando dados…
            {progress ? ` (${progress.done}/${progress.total} chunks)` : ""}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Estrutura agregada</div>
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
    </div>
  );
}
