import React from "react";

type FlowType = "import" | "export";
type ViewMode = "TABLE" | "CHARTS" | "BOTH";

export type DetailLevel = "CATEGORY" | "SUBCATEGORY" | "NCM";

type Diagnostics = {
  dictRows: number;
  distinctNcms: number;
  comexRows: number;
  comexZeroRows: number;
  apiLikelyDown: boolean;
  maxDepth: number;
  duplicateNcms: number;
  conflictingMappings: number;
};

type Totals = { fob: number; kg: number };

type Props = {
  cardStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  selectBoxStyle: React.CSSProperties;
  multiSelectStyleBase: React.CSSProperties;
  multiSelectSubcatStyle: React.CSSProperties;

  entity: string;
  entities: string[];
  onChangeEntity: (next: string) => void;

  year: number;
  years: number[];
  onChangeYear: (next: number) => void;

  flow: FlowType;
  onChangeFlow: (next: FlowType) => void;

  viewMode: ViewMode;
  onChangeViewMode: (next: ViewMode) => void;

  detailLevel: DetailLevel;
  onChangeDetailLevel: (next: DetailLevel) => void;

  subcatDepth: number;
  maxSubcatDepth: number;
  onChangeSubcatDepth: (next: number) => void;

  total: Totals;
  formatFOB: (v: number) => string;
  formatKG: (v: number) => string;
  formatUsdPerTon: (v: number) => string;

  diagnostics: Diagnostics | null;

  availableCategories: string[];
  availableSubcategories: string[];

  selectedCategories: string[];
  selectedSubcategories: string[];
  onChangeSelectedCategories: (next: string[]) => void;
  onChangeSelectedSubcategories: (next: string[]) => void;

  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetFilters: () => void;

  error?: string | null;

  // Helpers para evitar quebrar UX
  truncateLabel: (s: string, max?: number) => string;
};

export default function CgimControlsPanel(props: Props) {
  const {
    cardStyle,
    labelStyle,
    selectBoxStyle,
    multiSelectStyleBase,
    multiSelectSubcatStyle,

    entity,
    entities,
    onChangeEntity,

    year,
    years,
    onChangeYear,

    flow,
    onChangeFlow,

    viewMode,
    onChangeViewMode,

    detailLevel,
    onChangeDetailLevel,

    subcatDepth,
    maxSubcatDepth,
    onChangeSubcatDepth,

    total,
    formatFOB,
    formatKG,
    formatUsdPerTon,

    diagnostics,

    availableCategories,
    availableSubcategories,

    selectedCategories,
    selectedSubcategories,
    onChangeSelectedCategories,
    onChangeSelectedSubcategories,

    onExpandAll,
    onCollapseAll,
    onResetFilters,

    error,
    truncateLabel,
  } = props;

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

  const buttonsRow: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  const btnStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
  };

  return (
    <div style={cardStyle}>
      <div style={controlRow}>
        <div>
          <div style={labelStyle}>Entidade</div>
          <select
            value={entity}
            onChange={(e) => onChangeEntity(e.target.value)}
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
            onChange={(e) => onChangeYear(Number(e.target.value))}
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
            onChange={(e) => onChangeFlow(e.target.value as FlowType)}
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
            onChange={(e) => onChangeViewMode(e.target.value as ViewMode)}
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
            onChange={(e) => onChangeDetailLevel(e.target.value as DetailLevel)}
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
                onChange={(e) => onChangeSubcatDepth(Number(e.target.value))}
                style={selectBoxStyle}
              >
                {Array.from({ length: Math.max(1, maxSubcatDepth) }, (_, i) => i + 1).map(
                  (d) => (
                    <option key={d} value={d}>
                      {d === 1 ? "Subcategoria (1)" : `Subcategoria (1…${d})`}
                    </option>
                  )
                )}
              </select>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                Máximo nesta entidade: {maxSubcatDepth}
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={labelStyle}>Total (cesta anual – ano selecionado)</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>FOB: {formatFOB(total.fob)}</div>
          <div style={{ fontSize: 14, opacity: 0.85 }}>KG: {formatKG(total.kg)}</div>
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            US$/t: {formatUsdPerTon(total.kg > 0 ? total.fob / (total.kg / 1000) : 0)}
          </div>

          {diagnostics && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Diagnóstico</div>
              <div>
                Dicionário: {diagnostics.dictRows} linhas • {diagnostics.distinctNcms} NCMs únicos
              </div>
              <div>
                Duplicidades: {diagnostics.duplicateNcms} • Conflitos: {diagnostics.conflictingMappings}
              </div>
              <div>
                Comex rows: {diagnostics.comexRows} • Zeradas: {diagnostics.comexZeroRows}
              </div>
              {diagnostics.apiLikelyDown && <div>⚠️ API parece ter retornado tudo zero.</div>}
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
                  const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                  onChangeSelectedCategories(values);
                  onChangeSelectedSubcategories([]);
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
                  onChangeSelectedSubcategories(values);
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

            <div style={buttonsRow}>
              <button onClick={onExpandAll} style={btnStyle}>
                Expandir tudo
              </button>
              <button onClick={onCollapseAll} style={btnStyle}>
                Recolher tudo
              </button>
              <button onClick={onResetFilters} style={btnStyle}>
                Limpar filtros
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>{error}</div>}
    </div>
  );
}
