import React from "react";
import { HUDAlert } from "../hudTypes";
import { PanelFrame } from "../primitives/PanelFrame";

const severityColor: Record<HUDAlert["severity"], string> = {
  info: "rgba(255, 210, 140, 0.94)",
  warning: "rgba(255, 194, 120, 0.96)",
  critical: "rgba(255, 118, 118, 0.98)",
};

export function AlertBanner({
  alert,
  title,
  controlsText,
  opacity,
  style,
}: {
  alert: HUDAlert;
  title: string;
  controlsText: string;
  opacity: number;
  style?: React.CSSProperties;
}) {
  const accent = severityColor[alert.severity];
  return (
    <PanelFrame opacity={opacity} style={style}>
      <div style={{ padding: "14px 16px 12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(180,210,255,0.72)" }}>{title.toUpperCase()}</div>
          <div style={{ fontSize: 10, color: "rgba(190,210,235,0.6)" }}>ALERT BUS</div>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 20,
            letterSpacing: "0.12em",
            color: accent,
            textShadow: `0 0 16px ${accent}`,
            animation: alert.flashing ? "hudPulse 850ms ease-in-out infinite" : undefined,
          }}
        >
          △ {alert.text.toUpperCase()} △
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "rgba(205,220,240,0.68)", lineHeight: 1.35 }}>
          {alert.subtitle ?? controlsText}
        </div>
      </div>
    </PanelFrame>
  );
}
