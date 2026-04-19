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
        overflow: "visible",
        opacity,
        ...style,
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
