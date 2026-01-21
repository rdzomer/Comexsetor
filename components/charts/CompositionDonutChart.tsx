import React from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Tooltip,
  Legend,
  Cell,
} from "recharts";

type Datum = {
  name: string;
  fob?: number;
  kg?: number;
};

type Props = {
  title: string;
  subtitle?: string;

  // Dados já chegam corretos (assumido)
  data: Datum[];

  // Qual métrica o donut representa
  metricKey: "fob" | "kg";

  // Label humano para tooltip/legenda
  metricLabel: string;

  // Texto explicativo (parágrafo curto) para o box acima do gráfico
  insightText: string;

  // Legibilidade: quantos itens mostrar antes de agrupar em "Outros"
  maxItems?: number;

  // Exibir label no slice só acima desse % (evita poluição visual)
  minPercentLabel?: number;

  // Rodapé padrão
  footerText?: string;
};

function formatMoneyUS(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    Number(v) || 0
  );
}


function formatKg(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    Number(v) || 0
  );
}

function truncateMiddle(text: string, max = 40): string {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  const left = Math.ceil((max - 3) / 2);
  const right = Math.floor((max - 3) / 2);
  return `${t.slice(0, left)}...${t.slice(t.length - right)}`;
}

export default function CompositionDonutChart({
  title,
  subtitle,
  data,
  metricKey,
  metricLabel,
  insightText,
  maxItems = 10,
  minPercentLabel = 4,
  footerText = "Fonte: Comex Stat/MDIC. Elaboração própria.",
}: Props) {
  const cleaned = React.useMemo(() => {
    const rows = (data || [])
      .filter((d) => d && typeof (d as any)[metricKey] === "number" && Number((d as any)[metricKey]) > 0)
      .map((d) => ({
        name: String(d.name ?? "").trim() || "Sem rótulo",
        value: Number((d as any)[metricKey]) || 0,
      }))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const total = rows.reduce((acc, r) => acc + (r.value || 0), 0);

    if (rows.length <= maxItems) return { rows, total };

    const head = rows.slice(0, maxItems - 1);
    const tail = rows.slice(maxItems - 1);
    const others = tail.reduce((acc, r) => acc + (r.value || 0), 0);

    return {
      rows: [...head, { name: "Outros", value: others }],
      total,
    };
  }, [data, maxItems]);

  const total = cleaned.total || 0;

  // Paleta coerente (sem rainbow), próxima do roxo do módulo.
  const COLORS = [
    "var(--cgim-chart-1, #6D6AE8)",
    "var(--cgim-chart-2, #857FF0)",
    "var(--cgim-chart-3, #9A95F6)",
    "var(--cgim-chart-4, #B2AEFB)",
    "var(--cgim-chart-5, #C7C5FE)",
    "var(--cgim-chart-6, #A6B4FF)",
    "var(--cgim-chart-7, #8EA3FF)",
    "var(--cgim-chart-8, #7694FF)",
    "var(--cgim-chart-9, #5E82FF)",
    "var(--cgim-chart-10, #4C71F2)",
    "var(--cgim-chart-11, #3F61E6)",
    "var(--cgim-chart-12, #364FD9)",
  ];

  const renderLabel = (entry: any) => {
    if (!total) return "";
    const pct = (Number(entry?.value || 0) / total) * 100;
    if (pct < minPercentLabel) return "";
    return `${pct.toFixed(1)}%`;
  };

  const tooltipFormatter = (value: any, name: any) => {
    const v = Number(value || 0);
    const pct = total ? (v / total) * 100 : 0;
    const formatted = metricKey === "fob" ? `US$ ${formatMoneyUS(v)}` : `${formatKg(v)} ${metricLabel}`;
      return [`${formatted} • ${pct.toFixed(2)}%`, String(name)];
  };

  return (
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
        <div
          style={{
            fontWeight: 900,
            fontSize: 18,
            textAlign: "center",
            marginBottom: 6,
          }}
        >
          {title}
        </div>

        {subtitle ? (
          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              opacity: 0.75,
              marginBottom: 10,
            }}
          >
            {subtitle}
          </div>
        ) : (
          <div style={{ height: 10 }} />
        )}

        {/* Box explicativo */}
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            padding: "10px 12px",
            background: "rgba(0,0,0,0.02)",
            fontSize: 13,
            lineHeight: 1.35,
            marginBottom: 10,
          }}
        >
          {insightText}
        </div>

        <div style={{ width: "100%", height: 340, padding: "0 6px 12px 6px" }}>
          <ResponsiveContainer>
            <PieChart margin={{ top: 18, right: 8, bottom: 0, left: 8 }}>
              <Pie
                data={cleaned.rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="58%"
                innerRadius="52%"
                outerRadius="78%"
                paddingAngle={2}
                labelLine={false}
                label={renderLabel}
                isAnimationActive={false}
              >
                {cleaned.rows.map((_, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={COLORS[idx % COLORS.length]}
                    stroke="rgba(0,0,0,0.06)"
                  />
                ))}
              </Pie>

              <Tooltip
                formatter={tooltipFormatter}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  fontSize: 12,
                }}
                labelStyle={{ fontWeight: 800 }}
              />

              <Legend
                verticalAlign="bottom"
                align="center"
                iconType="circle"
                formatter={(value: any) => (
                  <span title={String(value)}>
                    {truncateMiddle(String(value))}
                  </span>
                )}
                wrapperStyle={{
                  fontSize: 12,
                  paddingTop: 8,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div
        style={{
          marginTop: 0,
          fontSize: 12,
          opacity: 0.7,
          textAlign: "center",
          paddingBottom: 12,
        }}
      >
        {footerText}
      </div>
    </div>
  );
}
