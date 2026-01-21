// CgimHierarchyTable.tsx
import React, { useMemo, useState } from "react";

/**
 * TABELA HIERÁRQUICA CGIM — EXIBIÇÃO ANALÍTICA COMPLETA
 * - Não altera API/services/cálculos. Apenas exibição.
 * - Estrutura: Categoria -> Subcategoria -> NCM
 * - Totais já devem vir agregados por nível no objeto recebido.
 *
 * COMO USAR (exemplo):
 * <CgimHierarchyTable data={hierarchyData} />
 *
 * Onde `hierarchyData` deve seguir o shape:
 * {
 *   categories: [
 *     {
 *       id: "iabr",
 *       name: "Instituto Aço Brasil",
 *       metrics: {...},
 *       subcategories: [
 *         {
 *           id: "semiacabados",
 *           name: "Semi-acabados",
 *           metrics: {...},
 *           ncms: [
 *             { ncm: "7207.12.00", description: "...", metrics: {...} }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

/** >>> AJUSTE AQUI SE SEUS NOMES DE CAMPO FOREM DIFERENTES <<< */
export type Metrics = {
  // Fluxos principais (já agregados por nível)
  expFob?: number; // Exportação (US$ FOB)
  expKg?: number; // Exportação (KG)
  impFob?: number; // Importação (US$ FOB)
  impKg?: number; // Importação (KG)

  // Saldos (já prontos no objeto)
  balanceFob?: number; // Saldo comercial (FOB)
  balanceKg?: number; // Saldo comercial (KG)

  // Preço médio (já pronto no objeto) — US$/t
  avgImpUsdPerTon?: number; // preço médio importação (US$/t)
  avgExpUsdPerTon?: number; // preço médio exportação (US$/t)
};

export type NcmNode = {
  ncm: string;
  description?: string;
  metrics: Metrics;
};

export type SubcategoryNode = {
  id: string;
  name: string;
  metrics: Metrics;
  ncms?: NcmNode[];
};

export type CategoryNode = {
  id: string;
  name: string;
  metrics: Metrics;
  subcategories?: SubcategoryNode[];
};

export type CgimHierarchyData = {
  categories: CategoryNode[];
};

type Props = {
  data: CgimHierarchyData | null | undefined;

  /** Opcional: controla se já abre tudo */
  defaultExpandAll?: boolean;

  /** Opcional: título exibido acima */
  title?: string;

  /** Opcional: altura máxima para scroll vertical (default: 520) */
  maxHeightPx?: number;
};

type RowKind = "category" | "subcategory" | "ncm";

type FlatRow = {
  key: string;
  kind: RowKind;
  depth: number; // 0 categoria, 1 sub, 2 ncm
  label: string;
  secondary?: string; // descrição NCM etc.
  metrics: Metrics;
  categoryId: string;
  subcategoryId?: string;
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid #E6E8EC",
    borderRadius: 14,
    background: "#fff",
    overflow: "hidden",
  },
  headerBar: {
    padding: "12px 14px",
    borderBottom: "1px solid #E6E8EC",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: "#111827",
  },
  hint: {
    fontSize: 12,
    color: "#6B7280",
  },
  tableWrap: {
    overflowX: "auto",
    overflowY: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: 1180, // garante rolagem horizontal confortável com novas colunas
    fontSize: 13,
  },
  theadTh: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    background: "#F9FAFB",
    color: "#111827",
    borderBottom: "1px solid #E6E8EC",
    padding: "10px 10px",
    textAlign: "right",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  theadThLeft: {
    position: "sticky",
    top: 0,
    left: 0,
    zIndex: 6,
    background: "#F9FAFB",
    color: "#111827",
    borderBottom: "1px solid #E6E8EC",
    padding: "10px 10px",
    textAlign: "left",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  tbodyTd: {
    borderBottom: "1px solid #F1F2F4",
    padding: "10px 10px",
    textAlign: "right",
    whiteSpace: "nowrap",
    color: "#111827",
  },
  tbodyTdLeftSticky: {
    position: "sticky",
    left: 0,
    zIndex: 4,
    borderBottom: "1px solid #F1F2F4",
    padding: "10px 10px",
    textAlign: "left",
    whiteSpace: "nowrap",
    background: "#fff",
  },
  rowCategory: {
    background: "#FFFFFF",
    fontWeight: 700,
  },
  rowSubcategory: {
    background: "#FFFFFF",
    fontWeight: 600,
  },
  rowNcm: {
    background: "#FFFFFF",
    fontWeight: 500,
  },
  expandBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 8,
    border: "1px solid #E6E8EC",
    background: "#fff",
    cursor: "pointer",
    marginRight: 8,
    userSelect: "none",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #E6E8EC",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    color: "#111827",
    background: "#fff",
  },
  groupHead: {
    background: "#F9FAFB",
    borderBottom: "1px solid #E6E8EC",
    textAlign: "center",
    fontWeight: 800,
  },
  groupHeadStickyLeft: {
    position: "sticky",
    left: 0,
    zIndex: 6,
    background: "#F9FAFB",
    borderBottom: "1px solid #E6E8EC",
    textAlign: "left",
    fontWeight: 800,
  },
};

function formatIntBR(n?: number) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function formatUsdBR(n?: number) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  // Mantém padrão do print: apenas número com separador BR, sem símbolo.
  // Se você preferir "US$" colado, ajuste aqui.
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function formatUsdPerTon(n?: number) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function balanceColor(value?: number): React.CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) return {};
  if (value > 0) return { color: "#0E7A2F" }; // verde
  if (value < 0) return { color: "#B42318" }; // vermelho
  return { color: "#111827" };
}

function indentStyle(depth: number): React.CSSProperties {
  const pad = 10 + depth * 18;
  return { paddingLeft: pad };
}

function makeChevron(open: boolean) {
  // símbolo simples e neutro (evita dependências)
  return open ? "▾" : "▸";
}

export default function CgimHierarchyTable({
  data,
  defaultExpandAll = false,
  title = "Tabela Analítica por Categoria / Subcategoria / NCM",
  maxHeightPx = 520,
}: Props) {
  const categories = data?.categories ?? [];

  const allCategoryIds = useMemo(() => categories.map((c) => c.id), [categories]);
  const allSubcategoryKeys = useMemo(() => {
    const keys: string[] = [];
    for (const c of categories) {
      for (const s of c.subcategories ?? []) keys.push(`${c.id}__${s.id}`);
    }
    return keys;
  }, [categories]);

  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(defaultExpandAll ? allCategoryIds : [])
  );
  const [openSubcategories, setOpenSubcategories] = useState<Set<string>>(
    () => new Set(defaultExpandAll ? allSubcategoryKeys : [])
  );

  // Re-sincroniza expansão caso data troque (evita estado “fantasma”)
  React.useEffect(() => {
    if (!defaultExpandAll) return;
    setOpenCategories(new Set(allCategoryIds));
    setOpenSubcategories(new Set(allSubcategoryKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultExpandAll, allCategoryIds.join("|"), allSubcategoryKeys.join("|")]);

  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];

    for (const c of categories) {
      rows.push({
        key: `cat:${c.id}`,
        kind: "category",
        depth: 0,
        label: c.name,
        metrics: c.metrics ?? {},
        categoryId: c.id,
      });

      const catOpen = openCategories.has(c.id);
      if (!catOpen) continue;

      for (const s of c.subcategories ?? []) {
        const subKey = `${c.id}__${s.id}`;
        rows.push({
          key: `sub:${subKey}`,
          kind: "subcategory",
          depth: 1,
          label: s.name,
          metrics: s.metrics ?? {},
          categoryId: c.id,
          subcategoryId: s.id,
        });

        const subOpen = openSubcategories.has(subKey);
        if (!subOpen) continue;

        for (const n of s.ncms ?? []) {
          rows.push({
            key: `ncm:${subKey}__${n.ncm}`,
            kind: "ncm",
            depth: 2,
            label: n.ncm,
            secondary: n.description,
            metrics: n.metrics ?? {},
            categoryId: c.id,
            subcategoryId: s.id,
          });
        }
      }
    }

    return rows;
  }, [categories, openCategories, openSubcategories]);

  function toggleCategory(catId: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  function toggleSubcategory(catId: string, subId: string) {
    const key = `${catId}__${subId}`;
    setOpenSubcategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setOpenCategories(new Set(allCategoryIds));
    setOpenSubcategories(new Set(allSubcategoryKeys));
  }

  function collapseAll() {
    setOpenCategories(new Set());
    setOpenSubcategories(new Set());
  }

  const hasAny = categories.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={styles.title}>{title}</div>
          <div style={styles.hint}>
            Colunas: Exportação, Importação, Balança, Preço médio (US$/t). Totais por nível já vêm agregados.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={styles.pill} title="Expande todas as categorias e subcategorias">
            <button
              type="button"
              onClick={expandAll}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Expandir tudo
            </button>
          </span>

          <span style={styles.pill} title="Recolhe todas as categorias e subcategorias">
            <button
              type="button"
              onClick={collapseAll}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Recolher tudo
            </button>
          </span>
        </div>
      </div>

      <div style={{ ...styles.tableWrap, maxHeight: maxHeightPx }}>
        <table style={styles.table}>
          <thead>
            {/* Linha 1: agrupamento visual (melhora legibilidade sem mudar layout geral) */}
            <tr>
              <th style={{ ...styles.groupHeadStickyLeft, padding: "10px 10px" }}>Hierarquia</th>
              <th style={styles.groupHead} colSpan={2} title="Exportações">
                EXP
              </th>
              <th style={styles.groupHead} colSpan={2} title="Importações">
                IMP
              </th>
              <th style={styles.groupHead} colSpan={2} title="Saldo comercial (Exportação - Importação)">
                BALANÇA
              </th>
              <th style={styles.groupHead} colSpan={2} title="Preço médio (US$/t) — já fornecido pelo objeto">
                PREÇO MÉDIO (US$/t)
              </th>
            </tr>

            {/* Linha 2: colunas finais (como no print) */}
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
            {!hasAny && (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    padding: 18,
                    color: "#6B7280",
                    fontSize: 13,
                    textAlign: "left",
                  }}
                >
                  Nenhum dado para exibir.
                </td>
              </tr>
            )}

            {flatRows.map((r) => {
              const isCategory = r.kind === "category";
              const isSub = r.kind === "subcategory";
              const isNcm = r.kind === "ncm";

              const rowStyle =
                isCategory ? styles.rowCategory : isSub ? styles.rowSubcategory : styles.rowNcm;

              const canExpand =
                (isCategory && (categories.find((c) => c.id === r.categoryId)?.subcategories?.length ?? 0) > 0) ||
                (isSub &&
                  (categories
                    .find((c) => c.id === r.categoryId)
                    ?.subcategories?.find((s) => s.id === r.subcategoryId)
                    ?.ncms?.length ?? 0) > 0);

              const isOpen = isCategory
                ? openCategories.has(r.categoryId)
                : isSub
                ? openSubcategories.has(`${r.categoryId}__${r.subcategoryId}`)
                : false;

              return (
                <tr key={r.key} style={rowStyle}>
                  {/* Coluna esquerda sticky */}
                  <td style={{ ...styles.tbodyTdLeftSticky, ...indentStyle(r.depth) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {canExpand ? (
                        <button
                          type="button"
                          style={styles.expandBtn}
                          onClick={() => {
                            if (isCategory) toggleCategory(r.categoryId);
                            if (isSub && r.subcategoryId) toggleSubcategory(r.categoryId, r.subcategoryId);
                          }}
                          aria-label={isOpen ? "Recolher" : "Expandir"}
                          title={isOpen ? "Recolher" : "Expandir"}
                        >
                          {makeChevron(isOpen)}
                        </button>
                      ) : (
                        <span style={{ width: 22, display: "inline-block" }} />
                      )}

                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ color: "#111827" }}>{r.label}</span>
                        {isNcm && r.secondary ? (
                          <span style={{ fontSize: 12, color: "#6B7280" }} title={r.secondary}>
                            {r.secondary.length > 80 ? r.secondary.slice(0, 80) + "…" : r.secondary}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  {/* EXP */}
                  <td style={styles.tbodyTd}>{formatUsdBR(r.metrics.expFob)}</td>
                  <td style={styles.tbodyTd}>{formatIntBR(r.metrics.expKg)}</td>

                  {/* IMP */}
                  <td style={styles.tbodyTd}>{formatUsdBR(r.metrics.impFob)}</td>
                  <td style={styles.tbodyTd}>{formatIntBR(r.metrics.impKg)}</td>

                  {/* BALANÇA */}
                  <td style={{ ...styles.tbodyTd, ...balanceColor(r.metrics.balanceFob) }}>
                    {formatUsdBR(r.metrics.balanceFob)}
                  </td>
                  <td style={{ ...styles.tbodyTd, ...balanceColor(r.metrics.balanceKg) }}>
                    {formatIntBR(r.metrics.balanceKg)}
                  </td>

                  {/* PREÇO MÉDIO */}
                  <td style={styles.tbodyTd}>{formatUsdPerTon(r.metrics.avgImpUsdPerTon)}</td>
                  <td style={styles.tbodyTd}>{formatUsdPerTon(r.metrics.avgExpUsdPerTon)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
