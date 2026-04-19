import React from "react";
import { HUDConfig, HUDState } from "../hudTypes";
import { PanelFrame } from "../primitives/PanelFrame";

export function TacticalPlotCluster({
  state,
  config,
  opacity,
  style,
}: {
  state: HUDState;
  config: HUDConfig;
  opacity: number;
  style?: React.CSSProperties;
}) {
  const size = 230;
  const center = size / 2;
  const radius = 78;
  return (
    <PanelFrame opacity={opacity} style={style}>
      <div style={{ padding: "14px" }}>
        <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ opacity: config.widgets.tacticalPlot.opacity }}>
          {[1, 0.74, 0.5].map((k) => (
            <circle key={k} cx={center} cy={center} r={radius * k} fill="none" stroke="rgba(180,220,255,0.12)" strokeWidth="1" />
          ))}
          <line x1={center} y1={20} x2={center} y2={size - 20} stroke="rgba(180,220,255,0.16)" />
          <line x1={20} y1={center} x2={size - 20} y2={center} stroke="rgba(180,220,255,0.16)" />
          <rect x={center - 42} y={center - 42} width="84" height="84" fill="none" stroke="rgba(200,220,255,0.22)" strokeDasharray="6 6" />
          <circle cx={center} cy={center} r="7" fill="rgba(210,255,204,0.94)" />
          <path d={`M ${center} ${center} L ${center + 68} ${center + 16}`} stroke="rgba(255,218,140,0.58)" strokeWidth="1.5" />
        </svg>
        <div style={{ marginTop: 6, textAlign: "center", color: "rgba(180,205,228,0.74)", fontSize: 11, letterSpacing: "0.12em" }}>TACTICAL PLOT</div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Mini label="TRACK" value={state.tactical.enemies > 0 ? "ACQ" : "SCAN"} />
          <Mini label="SOLN" value={state.tactical.enemies > 0 ? "EST" : "--"} />
        </div>
      </div>
    </PanelFrame>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(180,220,255,0.1)", padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ fontSize: 10, color: "rgba(175,205,228,0.62)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, color: "rgba(238,241,245,0.96)" }}>{value}</div>
    </div>
  );
}
