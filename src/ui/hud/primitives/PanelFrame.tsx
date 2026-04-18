import React from "react";

export function PanelFrame({
  children,
  opacity = 1,
  style,
}: {
  children: React.ReactNode;
  opacity?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        borderRadius: 18,
        border: `1px solid rgba(180, 220, 255, ${0.18 * opacity})`,
        background: `linear-gradient(180deg, rgba(8, 14, 24, ${0.78 * opacity}), rgba(3, 7, 14, ${0.62 * opacity}))`,
        boxShadow: `0 0 0 1px rgba(255,255,255,${0.04 * opacity}) inset, 0 12px 40px rgba(0,0,0,${0.38 * opacity})`,
        backdropFilter: "blur(10px)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(transparent 92%, rgba(140,190,255,.05) 100%), linear-gradient(90deg, transparent 96%, rgba(140,190,255,.04) 100%)",
          backgroundSize: "100% 6px, 6px 100%",
          opacity: 0.22 * opacity,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
