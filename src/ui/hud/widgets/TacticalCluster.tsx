import React from "react";
import { HUDConfig, HUDState } from "../hudTypes";
import { PanelFrame } from "../primitives/PanelFrame";

function RadarScope({ state, opacity }: { state: HUDState["radar"]; opacity: number }) {
  const size = 220;
  const center = size / 2;
  const radius = 88;
  const sweepDeg = state.placeholderSweepDeg;
  const contacts = state.contacts.slice(0, 10);
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <defs>
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={`rgba(198,255,226,${0.22 * opacity})`} />
          <stop offset="100%" stopColor="rgba(198,255,226,0)" />
        </radialGradient>
      </defs>
      <circle cx={center} cy={center} r={radius + 16} fill="url(#radarGlow)" />
      {[1, 0.72, 0.44, 0.18].map((k) => (
        <circle key={k} cx={center} cy={center} r={radius * k} fill="none" stroke={`rgba(180,220,220,${0.16 * opacity})`} strokeWidth="1" />
      ))}
      <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke={`rgba(160,200,220,${0.18 * opacity})`} />
      <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke={`rgba(160,200,220,${0.18 * opacity})`} />
      <path
        d={`M ${center} ${center} L ${center + Math.cos((sweepDeg * Math.PI) / 180) * radius} ${center + Math.sin((sweepDeg * Math.PI) / 180) * radius}`}
        stroke={`rgba(235,255,185,${0.72 * opacity})`}
        strokeWidth="2"
      />
      <circle cx={center} cy={center} r="4" fill={`rgba(230,255,220,${0.94 * opacity})`} />
      {contacts.map((contact, i) => {
        const a = contact.bearingRad;
        const r = radius * Math.max(0.1, Math.min(1, contact.distanceNorm));
        const x = center + Math.cos(a) * r;
        const y = center + Math.sin(a) * r;
        const alpha = 0.46 + Math.min(0.48, contact.threat * 0.28);
        return <circle key={`${contact.kind}-${i}`} cx={x} cy={y} r={2.6 + Math.min(2, contact.threat * 0.4)} fill={`rgba(244,255,184,${alpha * opacity})`} />;
      })}
    </svg>
  );
}

export function TacticalCluster({
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
  return (
    <PanelFrame opacity={opacity} style={style}>
      <div style={{ padding: "14px 14px 12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14, letterSpacing: "0.08em", color: "rgba(214,236,250,0.95)" }}>
            ▶ WAVE {state.tactical.waveNumber} · {state.tactical.currentEnemyLabel.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: "rgba(190,210,235,0.62)" }}>TACTICAL</div>
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 11 }}>
          <Readout label="BULLETS" value={state.tactical.bullets} />
          <Readout label="ENEMIES" value={state.tactical.enemies} />
          <Readout label="SHARDS" value={state.tactical.shards} />
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: "rgba(190,210,235,0.62)", letterSpacing: "0.11em" }}>INBOUND HOSTILES</div>
        {config.widgets.radar.enabled && (
          <div style={{ marginTop: 8, opacity: config.widgets.radar.opacity }}>
            <RadarScope state={state.radar} opacity={opacity} />
          </div>
        )}
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr auto", rowGap: 8, fontSize: 12 }}>
          <Metric label="CLOSURE" value={`${state.tactical.closureRate >= 0 ? "+" : ""}${state.tactical.closureRate.toFixed(1)}`} />
          <Metric label="RANGE" value={`${state.tactical.nearestRange.toFixed(1)}m`} />
        </div>
      </div>
    </PanelFrame>
  );
}

function Readout({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid rgba(180,220,255,0.12)", borderRadius: 12, padding: "8px 10px", background: "rgba(255,255,255,0.03)" }}>
      <div style={{ color: "rgba(175,205,228,0.65)", fontSize: 10 }}>{label}</div>
      <div style={{ marginTop: 4, color: "rgba(235,243,250,0.96)", fontSize: 18 }}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ color: "rgba(175,205,228,0.72)" }}>{label}</div>
      <div style={{ color: "rgba(245,220,165,0.96)", fontSize: 18 }}>{value}</div>
    </>
  );
}
