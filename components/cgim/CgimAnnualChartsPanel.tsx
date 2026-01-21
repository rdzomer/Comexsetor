import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ReferenceLine,
  ComposedChart,
} from "recharts";
import CompositionDonutChart from "../charts/CompositionDonutChart";

type SeriesPoint = { name: string; fob?: number; kg?: number };
type PricePoint = { name: string; importPrice: number; exportPrice: number };
type BalancePointSigned = {
  name: string;
  exportFobPos: number;
  importFobNeg: number;
  balanceFob: number;
};

type Props = {
  cardStyle: React.CSSProperties;
  sourceFooterStyle: React.CSSProperties;

  basketLabel: string;

  chartsLoading: boolean;
  chartsError: string | null;

  annualImportSeries: SeriesPoint[];
  annualExportSeries: SeriesPoint[];
  annualPriceIeSeries: PricePoint[];
  annualBalanceSeriesSigned: BalancePointSigned[];
  balanceMaxAbs: number;

  tickKg: (v: any) => string;
  tickFob: (v: any) => string;
  tickPrice: (v: any) => string;

  // Composição
  categoryBars: any[];
  subcatBars: any[];
  categoryBarsKg: any[];
  subcatBarsKg: any[];

  compositionCategoryTextFob: string;
  compositionSubcategoryTextFob: string;
  compositionCategoryTextKg: string;
  compositionSubcategoryTextKg: string;
};

export default function CgimAnnualChartsPanel(props: Props) {
  const {
    cardStyle,
    sourceFooterStyle,
    basketLabel,
    chartsLoading,
    chartsError,
    annualImportSeries,
    annualExportSeries,
    annualPriceIeSeries,
    annualBalanceSeriesSigned,
    balanceMaxAbs,
    tickKg,
    tickFob,
    tickPrice,
    categoryBars,
    subcatBars,
    categoryBarsKg,
    subcatBarsKg,
    compositionCategoryTextFob,
    compositionSubcategoryTextFob,
    compositionCategoryTextKg,
    compositionSubcategoryTextKg,
  } = props;

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 900 }}>Gráficos Anuais (Comex Stat)</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{chartsLoading ? "Carregando…" : "OK"}</div>
      </div>

      {chartsError && <div style={{ marginBottom: 10, color: "#b00020", fontSize: 13 }}>{chartsError}</div>}

      {!chartsLoading && !annualImportSeries.length && (
        <div style={{ fontSize: 13, opacity: 0.75 }}>Sem dados para gráficos (cesta vazia).</div>
      )}

      {!!annualImportSeries.length && (
        <>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Cesta exibida: <strong>{basketLabel}</strong>
          </div>

          <div className="cgimAnnualGrid2">
            {/* Import KG */}
            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Importações (KG) — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={annualImportSeries}
                      barSize={42}
                      barCategoryGap="10%"
                      barGap={2}
                      margin={{ top: 10, right: 20, left: 54, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickKg} domain={[0, (dataMax: number) => Math.max(0, dataMax) * 1.1]} />
                      <Tooltip formatter={(value: any) => tickKg(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <Bar dataKey="kg" name="Importações (KG)" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>

            {/* Import FOB */}
            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Importações (US$ FOB) — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={annualImportSeries}
                      barSize={42}
                      barCategoryGap="10%"
                      barGap={2}
                      margin={{ top: 10, right: 20, left: 54, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickFob} domain={[0, (dataMax: number) => Math.max(0, dataMax) * 1.1]} />
                      <Tooltip formatter={(value: any) => tickFob(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <Bar dataKey="fob" name="Importações (US$ FOB)" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>

            {/* Export KG */}
            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Exportações (KG) — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={annualExportSeries}
                      barSize={42}
                      barCategoryGap="10%"
                      barGap={2}
                      margin={{ top: 10, right: 20, left: 54, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickKg} domain={[0, (dataMax: number) => Math.max(0, dataMax) * 1.1]} />
                      <Tooltip formatter={(value: any) => tickKg(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <Bar dataKey="kg" name="Exportações (KG)" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>

            {/* Export FOB */}
            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Exportações (US$ FOB) — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={annualExportSeries}
                      barSize={42}
                      barCategoryGap="10%"
                      barGap={2}
                      margin={{ top: 10, right: 20, left: 54, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickFob} domain={[0, (dataMax: number) => Math.max(0, dataMax) * 1.1]} />
                      <Tooltip formatter={(value: any) => tickFob(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <Bar dataKey="fob" name="Exportações (US$ FOB)" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>
          </div>

          <div style={{ height: 12 }} />

          {/* Preços + Balança */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Preços Médios (US$/t) — Importação vs Exportação — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={annualPriceIeSeries} margin={{ top: 10, right: 20, left: 54, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickPrice} />
                      <Tooltip formatter={(value: any) => tickPrice(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="importPrice"
                        name="Preço Médio Importação (US$/t)"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="exportPrice"
                        name="Preço Médio Exportação (US$/t)"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>

            <div
              style={{
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 0 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 8 }}>
                  Exportação, Importação e Balança Comercial (US$ FOB) — {basketLabel}
                </div>
                <div style={{ padding: "0 6px 12px 6px" }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart
                      data={annualBalanceSeriesSigned}
                      margin={{ top: 10, right: 20, left: 54, bottom: 10 }}
                      barSize={24}
                      barCategoryGap="26%"
                      barGap={2}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={tickFob} domain={[-balanceMaxAbs, balanceMaxAbs]} />
                      <Tooltip formatter={(value: any) => tickFob(value)} labelFormatter={(label) => `Ano: ${label}`} />
                      <Legend />
                      <ReferenceLine y={0} stroke="#111" strokeWidth={2} />
                      <Bar dataKey="exportFobPos" name="Exportação" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="importFobNeg" name="Importação" fill="#ef4444" radius={[0, 0, 6, 6]} />
                      <Line
                        type="monotone"
                        dataKey="balanceFob"
                        name="Balança Comercial"
                        stroke="#10b981"
                        strokeWidth={3}
                        dot={{ r: 5, fill: "#fff", stroke: "#10b981", strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: "#fff", stroke: "#10b981", strokeWidth: 2 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={sourceFooterStyle}>Fonte: Comex Stat/MDIC. Elaboração própria.</div>
            </div>
          </div>

          <div style={{ height: 12 }} />

          {/* Composição — donuts */}
          <div className="cgimAnnualGrid2">
            <CompositionDonutChart
              title="Composição por Categoria (FOB)"
              subtitle={`Cesta: ${basketLabel}`}
              data={categoryBars}
              metricKey="fob"
              metricLabel="FOB (US$)"
              insightText={compositionCategoryTextFob}
              maxItems={10}
              minPercentLabel={4}
              footerText="Fonte: Comex Stat/MDIC. Elaboração própria."
            />

            <CompositionDonutChart
              title="Composição por Subcategoria (FOB)"
              subtitle={`Cesta: ${basketLabel}`}
              data={subcatBars}
              metricKey="fob"
              metricLabel="FOB (US$)"
              insightText={compositionSubcategoryTextFob}
              maxItems={12}
              minPercentLabel={4}
              footerText="Fonte: Comex Stat/MDIC. Elaboração própria."
            />

            <CompositionDonutChart
              title="Composição por Categoria (KG)"
              subtitle={`Cesta: ${basketLabel}`}
              data={categoryBarsKg}
              metricKey="kg"
              metricLabel="KG"
              insightText={compositionCategoryTextKg}
              maxItems={10}
              minPercentLabel={4}
              footerText="Fonte: Comex Stat/MDIC. Elaboração própria."
            />

            <CompositionDonutChart
              title="Composição por Subcategoria (KG)"
              subtitle={`Cesta: ${basketLabel}`}
              data={subcatBarsKg}
              metricKey="kg"
              metricLabel="KG"
              insightText={compositionSubcategoryTextKg}
              maxItems={12}
              minPercentLabel={4}
              footerText="Fonte: Comex Stat/MDIC. Elaboração própria."
            />
          </div>
        </>
      )}
    </div>
  );
}
