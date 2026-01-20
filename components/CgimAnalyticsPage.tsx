// components/CgimAnalyticsPage.tsx
import React from "react";
import { CgimHierarchyTable } from "./CgimHierarchyTable";
import {
  buildHierarchyTree,
  computeTotal,
  listCategories,
  listSubcategories,
  type DetailLevel,
  type HierarchyNode,
} from "../utils/cgimAggregation";

import * as cgimDictionaryService from "../services/cgimDictionaryService";
import { fetchAnnualBasketByNcm, type CgimAnnualBasketRow } from "../services/cgimBasketComexService";

type DictionaryRow = {
  ncm: string;
  categoria: string;
  subcategoria: string | null;
};

type SortKey = "fob" | "kg";
type SortDir = "asc" | "desc";
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
  throw new Error(`Não encontrei função no cgimDictionaryService. Exporte uma destas: ${names.join(", ")}`);
}

function truncateLabel(s: string, max = 70) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ✅ Trata valores "vazios" de subcategoria (inclui 0)
function isEmptySubValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return v === 0;
  const s = String(v).trim();
  return s === "" || s === "0";
}

// ✅ Monta um label de subcategoria com profundidade, ignorando "0"
function buildSubcategoryLabel(subs: Array<string | null>, depth: number): string | null {
  const parts = subs
    .slice(0, depth)
    .map((s) => (isEmptySubValue(s) ? "" : String(s ?? "").trim()))
    .filter(Boolean);

  if (!parts.length) return null;
  return parts.join(" > ");
}

export default function CgimAnalyticsPage() {
  const [entity, setEntity] = React.useState<string>("IABR");
  const [year, setYear] = React.useState<number>(2024);
  const [flow, setFlow] = React.useState<FlowType>("import");

  const [detailLevel, setDetailLevel] = React.useState<DetailLevel>("SUBCATEGORY");

  // ✅ profundidade do caminho de subcategoria
  const [subcatDepth, setSubcatDepth] = React.useState<number>(1);
  const [maxSubcatDepth, setMaxSubcatDepth] = React.useState<number>(1);

  const [sortKey, setSortKey] = React.useState<SortKey>("fob");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);
  const [selectedSubcategories, setSelectedSubcategories] = React.useState<string[]>([]);

  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [tree, setTree] = React.useState<HierarchyNode[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  // ✅ entidades do Excel; fallback inicial (até carregar pack)
  const [entities, setEntities] = React.useState<string[]>(["IABR", "ABIVIDRO", "ABAL", "IBÁ"]);
  const years = React.useMemo(() => [2022, 2023, 2024, 2025], []);

  const [diagnostics, setDiagnostics] = React.useState<{
    dictRows: number;
    distinctNcms: number;
    missingCategoria: number;
    missingSubcategoria: number;
    comexRows: number;
    comexZeroRows: number;
    unmappedNcms: number;
    apiLikelyDown: boolean;
    maxDepth: number;
    duplicateNcms: number;
    conflictingMappings: number;
  } | null>(null);

  const loadDictionary = React.useMemo(() => {
    return pickFn<(entity: string) => Promise<cgimDictionaryService.CgimDictEntry[]>>(
      cgimDictionaryService,
      ["loadCgimDictionaryForEntity", "loadDictionaryForEntity", "getCgimDictionaryForEntity", "getDictionaryForEntity"]
    );
  }, []);

  // ✅ Cache em memória do dicionário por entidade (acelera troca de ano/fluxo)
  const dictCacheRef = React.useRef<Map<string, cgimDictionaryService.CgimDictEntry[]>>(new Map());

  // ✅ Carrega entidades do Excel (pack)
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
      } catch (e) {
        console.warn("Falha ao carregar entidades do Excel. Mantendo lista padrão.", e);
      }
    }
    loadEntitiesFromExcel();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Carregamento principal
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      // ✅ FIX PRINCIPAL: limpa estado imediatamente ao iniciar nova carga
      setTree([]);
      setExpandedIds(new Set());
      setDiagnostics(null);
      setError(null);
      setLastUpdated(null);

      setLoading(true);
      setProgress(null);

      try {
        const cached = dictCacheRef.current.get(entity);
        const dictEntries = cached ?? (await loadDictionary(entity));
        if (!cached) dictCacheRef.current.set(entity, dictEntries);

        const maxDepthFound =
          dictEntries.reduce((acc, e) => {
            const depth = (e.subcategorias ?? []).filter((x) => !isEmptySubValue(x)).length;
            return Math.max(acc, depth);
          }, 0) || 1;

        setMaxSubcatDepth(maxDepthFound);

        const effectiveDepth = Math.min(subcatDepth, maxDepthFound || 1);
        if (effectiveDepth !== subcatDepth) setSubcatDepth(effectiveDepth);

        const dictRowsRaw: DictionaryRow[] = (dictEntries ?? []).map((e) => {
          const categoria = String(e.categoria ?? "").trim();
          const subLabel = buildSubcategoryLabel(e.subcategorias ?? [], effectiveDepth);

          return {
            ncm: e.ncm,
            categoria: categoria || "Sem categoria (mapeamento incompleto)",
            subcategoria: subLabel,
          };
        });

        // ✅ Linhas completas (SEM dedup) apenas para semear a taxonomia (categorias/subcategorias)
        // Isso evita “sumir” categoria quando a UI deduplica NCMs duplicadas por estabilidade.
        const seedRows: DictionaryRow[] = (dictRowsRaw ?? [])
          .map((r) => ({
            ncm: normalizeNcm(r.ncm),
            categoria: String(r.categoria ?? "").trim() || "Sem categoria (mapeamento incompleto)",
            subcategoria: r.subcategoria ? String(r.subcategoria).trim() : null,
          }))
          .filter((r) => !!r.ncm) as DictionaryRow[];

        // ✅ (CGIM) Dedup por NCM: evita sobrescrita silenciosa ("last wins")
        // Se o mesmo NCM aparece em mais de uma categoria/subcategoria no Excel,
        // a estrutura pode "sumir" (ex: Semi-acabados) por causa de overwrite.
        const seen = new Map<string, { categoria: string; subcategoria: string | null }>();
        let duplicateNcms = 0;
        let conflictingMappings = 0;

        const dictRows: DictionaryRow[] = [];
        for (const r of dictRowsRaw) {
          const ncmNorm = normalizeNcm(r.ncm);
          if (!ncmNorm) continue;
          const nextMap = { categoria: r.categoria, subcategoria: r.subcategoria };

          if (!seen.has(ncmNorm)) {
            seen.set(ncmNorm, nextMap);
            dictRows.push({ ...r, ncm: ncmNorm });
            continue;
          }

          duplicateNcms++;
          const prev = seen.get(ncmNorm)!;
          const isConflict =
            prev.categoria !== nextMap.categoria || (prev.subcategoria ?? null) !== (nextMap.subcategoria ?? null);
          if (isConflict) {
            conflictingMappings++;
            // mantém o primeiro mapeamento (mais estável/"primeiro wins")
            // (se quiser inverter para "último wins", troque aqui)
          }
        }

        const ncms = Array.from(new Set(dictRows.map((r) => r.ncm).filter(Boolean)));

        const basketRows: CgimAnnualBasketRow[] = await fetchAnnualBasketByNcm({
          entity,
          year: String(year),
          flow,
          ncms,
          // ✅ performance: mais concorrência (mantendo batch) melhora tempo
          // se aparecer 429, reduza concurrency para 2.
          chunkSize: 80,
          concurrency: 4,
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

        const dictNcmSet = new Set(dictRows.map((d) => normalizeNcm(d.ncm)).filter(Boolean));
        const unmappedNcms = comexRows.filter((r) => !dictNcmSet.has(normalizeNcm(r.ncm))).length;

        const comexZeroRows = comexRows.filter(
          (r) => (Number(r.metricFOB) || 0) === 0 && (Number(r.metricKG) || 0) === 0
        ).length;

        const missingCategoria = dictRows.filter(
          (d) => !String(d.categoria ?? "").trim() || String(d.categoria).includes("Sem categoria")
        ).length;

        const missingSubcategoria = dictRows.filter((d) => !String(d.subcategoria ?? "").trim()).length;

        const apiLikelyDown = comexRows.length > 0 && comexZeroRows === comexRows.length;

        setDiagnostics({
          dictRows: dictRows.length,
          distinctNcms: ncms.length,
          missingCategoria,
          missingSubcategoria,
          comexRows: comexRows.length,
          comexZeroRows,
          unmappedNcms,
          apiLikelyDown,
          maxDepth: maxDepthFound,
          duplicateNcms,
          conflictingMappings,
        });

        const nextTree = buildHierarchyTree({
          dictRows,
          seedRows,
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

  const progressPct = React.useMemo(() => {
    if (!progress || !progress.total) return null;
    return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)));
  }, [progress]);

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
  const labelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.7, marginBottom: 6 };

  const controlRow: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: 12,
  };

  // ✅ NOVO: empilha categorias/subcategorias/ações (subcat fica 100% largura)
  const filtersStack: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  // ✅ deixa a caixa maior por padrão (você pode ajustar aqui)
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
    minHeight: 260, // ✅ mais alto
  };

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      {loading && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #eee",
            background: "#fff",
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Carregando…</div>
            <div style={{ fontSize: 12, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
              {progress ? `${progress.done}/${progress.total}` : "—"}
              {progressPct !== null ? ` • ${progressPct}%` : ""}
            </div>
          </div>
          <div style={{ height: 8, marginTop: 8, borderRadius: 999, background: "#e9e9e9", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progressPct ?? 15}%`,
                background: "#111",
                transition: "width 200ms ease",
              }}
            />
          </div>
        </div>
      )}

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
              onChange={(e) => {
                // ✅ FIX: limpa filtros e UI imediatamente ao trocar entidade
                setSelectedCategories([]);
                setSelectedSubcategories([]);
                setExpandedIds(new Set());
                setTree([]);
                setDiagnostics(null);
                setError(null);
                setLastUpdated(null);

                setEntity(e.target.value);
              }}
              disabled={loading}
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
              disabled={loading}
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
              disabled={loading}
              style={selectBoxStyle}
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
              disabled={loading}
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
                  disabled={loading}
                  style={selectBoxStyle}
                >
                  {Array.from({ length: Math.max(1, maxSubcatDepth) }, (_, i) => i + 1).map((d) => (
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
        </div>

        <div style={{ height: 12 }} />

        {/* ✅ NOVO LAYOUT: subcategorias ocupam 100% da largura */}
        <div style={filtersStack}>
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
              disabled={loading}
              style={multiSelectStyleBase}
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
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
              disabled={loading}
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

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={labelStyle}>Ações</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => expandAll()}
                  disabled={loading || !tree.length}
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
                  disabled={loading || !tree.length}
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
                  disabled={loading}
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

            <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Total (cesta anual)</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                FOB: {formatMoneyUS(total.fob)}
              </div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>KG: {formatKg(total.kg)}</div>

              {diagnostics && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #eee", fontSize: 12, opacity: 0.9 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Diagnóstico (rápido)</div>
                  <div>
                    Dicionário: {diagnostics.dictRows} linhas • {diagnostics.distinctNcms} NCMs únicos
                  </div>
                  <div>
                    Duplicidades de NCM (no Excel): {diagnostics.duplicateNcms}
                    {diagnostics.conflictingMappings ? (
                      <> • Conflitos de mapeamento: {diagnostics.conflictingMappings}</>
                    ) : null}
                  </div>
                  <div>Sem categoria (no dicionário): {diagnostics.missingCategoria}</div>
                  <div>Sem subcategoria (no dicionário): {diagnostics.missingSubcategoria}</div>
                  <div>Máx. profundidade subcat: {diagnostics.maxDepth}</div>
                  <div>
                    Comex: {diagnostics.comexRows} NCMs • Zeradas (FOB=0 e KG=0): {diagnostics.comexZeroRows}
                  </div>
                  <div>Não mapeadas (comex x dicionário): {diagnostics.unmappedNcms}</div>
                  {diagnostics.apiLikelyDown && (
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      ⚠️ Parece que a API do ComexStat falhou (tudo zerou). Mostrando estrutura do dicionário com zeros.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>{error}</div>}
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
