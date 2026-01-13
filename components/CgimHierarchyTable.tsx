// components/CgimHierarchyTable.tsx
import React from "react";
import type { DetailLevel, HierarchyNode, Metrics } from "../utils/cgimAggregation";

type SortKey = "fob" | "kg";
type SortDir = "asc" | "desc";

export interface CgimHierarchyTableProps {
  tree: HierarchyNode[];

  detailLevel: DetailLevel;

  // filtros
  selectedCategories: string[];      // vazio = todas
  selectedSubcategories: string[];   // vazio = todas (dentro das categorias selecionadas)

  // expand/collapse
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;

  // ordenação
  sortKey: SortKey;
  sortDir: SortDir;
  onChangeSort: (k: SortKey) => void;

  // formatação
  formatFOB?: (v: number) => string;
  formatKG?: (v: number) => string;
}

type Row = {
  node: HierarchyNode;
  depth: number;
  isVisible: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
};

function defaultFormatFOB(v: number): string {
  // US$ com separador BR
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

function defaultFormatKG(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

function compareNumber(a: number, b: number, dir: SortDir): number {
  const diff = a - b;
  return dir === "asc" ? diff : -diff;
}

function getMetric(m: Metrics, key: SortKey): number {
  return key === "fob" ? m.fob : m.kg;
}

function allowedMaxDepth(detailLevel: DetailLevel): number {
  // depth: 0=Categoria, 1=Subcategoria ou NCM direto, 2=NCM (quando há subcategoria)
  if (detailLevel === "CATEGORY") return 0;
  if (detailLevel === "SUBCATEGORY") return 1;
  return 2;
}

function nodePassesFilters(
  node: HierarchyNode,
  selectedCategories: Set<string>,
  selectedSubcategories: Set<string>
): boolean {
  if (node.level === "category") {
    return selectedCategories.size === 0 || selectedCategories.has(node.name);
  }

  // sub/ncm precisam respeitar categoria e subcategoria (se houver)
  const cat = node.meta?.categoria;
  const sub = node.meta?.subcategoria ?? null;

  if (selectedCategories.size && cat && !selectedCategories.has(cat)) return false;

  // filtro de subcategoria só faz sentido quando a linha tem subcategoria
  if (selectedSubcategories.size) {
    if (node.level === "subcategory") return selectedSubcategories.has(node.name);
    if (node.level === "ncm") {
      // se NCM tem subcategoria, precisa estar selecionada; se não tem, passa (porque não existe)
      if (sub) return selectedSubcategories.has(sub);
      return true;
    }
  }

  return true;
}

function sortChildren(node: HierarchyNode, sortKey: SortKey, sortDir: SortDir): HierarchyNode {
  if (!node.children?.length) return node;

  const children = [...node.children].map((c) => sortChildren(c, sortKey, sortDir));

  children.sort((a, b) => {
    // Mantém categorias/subcategorias acima de NCM (quando misturado)
    if (a.level !== b.level) {
      const order = (lvl: string) => (lvl === "subcategory" ? 0 : lvl === "ncm" ? 1 : 2);
      return order(a.level) - order(b.level);
    }
    // Entre nós do mesmo nível, ordena por métrica (desc padrão)
    return compareNumber(getMetric(a.metrics, sortKey), getMetric(b.metrics, sortKey), sortDir);
  });

  return { ...node, children };
}

export const CgimHierarchyTable: React.FC<CgimHierarchyTableProps> = ({
  tree,
  detailLevel,
  selectedCategories,
  selectedSubcategories,
  expandedIds,
  onToggleExpand,
  sortKey,
  sortDir,
  onChangeSort,
  formatFOB = defaultFormatFOB,
  formatKG = defaultFormatKG,
}) => {
  const maxDepth = allowedMaxDepth(detailLevel);

  const catSet = React.useMemo(() => new Set(selectedCategories.filter(Boolean)), [selectedCategories]);
  const subSet = React.useMemo(() => new Set(selectedSubcategories.filter(Boolean)), [selectedSubcategories]);

  const sortedTree = React.useMemo(() => {
    // ordena top-level também por métrica
    const nodes = (tree ?? []).map((n) => sortChildren(n, sortKey, sortDir));
    return [...nodes].sort((a, b) => compareNumber(getMetric(a.metrics, sortKey), getMetric(b.metrics, sortKey), sortDir));
  }, [tree, sortKey, sortDir]);

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];

    function walk(node: HierarchyNode, depth: number, parentVisible: boolean) {
      const passes = nodePassesFilters(node, catSet, subSet);
      const isVisible = parentVisible && passes;

      // Regra de corte por nível: se depth > maxDepth, não renderiza (mas pode ser usado para somas já prontas)
      if (depth <= maxDepth) {
        const hasChildren = Boolean(node.children && node.children.length && depth < maxDepth);
        const isExpanded = expandedIds.has(node.id);

        out.push({
          node,
          depth,
          isVisible,
          hasChildren,
          isExpanded,
        });

        // Só desce se (a) tem filhos, (b) está expandido, (c) ainda não passou do maxDepth
        if (hasChildren && isExpanded) {
          for (const ch of node.children ?? []) walk(ch, depth + 1, isVisible);
        }
      }
    }

    for (const top of sortedTree) walk(top, 0, true);

    return out.filter((r) => r.isVisible);
  }, [sortedTree, expandedIds, catSet, subSet, maxDepth]);

  const headerBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    padding: 0,
  };

  const cellStyle: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #eee", verticalAlign: "middle" };

  return (
    <div style={{ border: "1px solid #e6e6e6", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={{ ...cellStyle, textAlign: "left" }}>Estrutura</th>
            <th style={{ ...cellStyle, textAlign: "right", width: 180 }}>
              <button style={headerBtnStyle} onClick={() => onChangeSort("fob")} title="Ordenar por FOB">
                FOB {sortKey === "fob" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </button>
            </th>
            <th style={{ ...cellStyle, textAlign: "right", width: 180 }}>
              <button style={headerBtnStyle} onClick={() => onChangeSort("kg")} title="Ordenar por KG">
                KG {sortKey === "kg" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </button>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td style={{ ...cellStyle, padding: 16 }} colSpan={3}>
                Nenhum dado para exibir com os filtros atuais.
              </td>
            </tr>
          ) : (
            rows.map(({ node, depth, hasChildren, isExpanded }) => {
              const indent = depth * 18;

              const labelWeight =
                node.level === "category" ? 800 : node.level === "subcategory" ? 700 : 500;

              const labelPrefix =
                node.level === "category" ? "Categoria" : node.level === "subcategory" ? "Subcategoria" : "NCM";

              return (
                <tr key={node.id}>
                  <td style={{ ...cellStyle, textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: indent }}>
                      {hasChildren ? (
                        <button
                          onClick={() => onToggleExpand(node.id)}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            border: "1px solid #ddd",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                          aria-label={isExpanded ? "Recolher" : "Expandir"}
                        >
                          {isExpanded ? "–" : "+"}
                        </button>
                      ) : (
                        <div style={{ width: 26 }} />
                      )}

                      <div>
                        <div style={{ fontWeight: labelWeight }}>
                          {node.name}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.65 }}>
                          {labelPrefix}
                          {node.level === "ncm" && node.meta?.categoria ? ` • ${node.meta.categoria}${node.meta.subcategoria ? ` / ${node.meta.subcategoria}` : ""}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatFOB(node.metrics.fob)}
                  </td>

                  <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatKG(node.metrics.kg)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
