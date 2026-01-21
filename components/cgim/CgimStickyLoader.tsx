import React from "react";

type Props = {
  show: boolean;
  title: string;
  progress?: { done: number; total: number } | null;
  cardStyle: React.CSSProperties;
};

export default function CgimStickyLoader({ show, title, progress, cardStyle }: Props) {
  if (!show) return null;

  const hasProgress = !!(progress && progress.total);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, Math.round((progress!.done / progress!.total) * 100)))
    : 0;

  return (
    <div
      style={{
        ...cardStyle,
        position: "sticky",
        top: 10,
        zIndex: 50,
        boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>{title}</div>
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
  );
}
