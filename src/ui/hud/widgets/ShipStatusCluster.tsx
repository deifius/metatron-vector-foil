import React from "react";
import { HUDConfig, HUDState } from "../hudTypes";
import { PanelFrame } from "../primitives/PanelFrame";
import { RingGauge } from "../primitives/RingGauge";

function shieldColor(valuePct: number) {
  if (valuePct >= 60) return "rgba(102, 255, 212, 0.98)";
  if (valuePct >= 30) return "rgba(255, 208, 92, 0.98)";
  return "rgba(255, 108, 108, 0.98)";
}

function fuelColor(valuePct: number) {
  if (valuePct >= 60) return "rgba(104, 225, 255, 0.96)";
  if (valuePct >= 30) return "rgba(180, 245, 255, 0.96)";
  return "rgba(255, 214, 120, 0.98)";
}

function GravTrace({ value, opacity }: { value: number; opacity: number }) {
  const width = 320;
  const height = 64;
  const points = Array.from({ length: 32 }, (_, i) => {
    const x = (i / 31) * width;
    const wave = Math.sin(i * 0.55 + value * 0.16) * (6 + Math.min(14, value * 0.02));
    const jitter = Math.cos(i * 1.4 + value * 0.02) * 4;
    const y = height / 2 + wave + jitter;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline fill="none" stroke={`rgba(255, 228, 162, ${0.85 * opacity})`} strokeWidth="1.8" points={points} />
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={`rgba(180,220,255,${0.12 * opacity})`} strokeWidth="1" />
    </svg>
  );
}

export function ShipStatusCluster({
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
  const shield = shieldColor(state.player.shieldsPct);
  const fuel = fuelColor(state.player.fuelPct);
  return (
    <PanelFrame opacity={opacity} style={style}>
      <div style={{ padding: "12px 14px 12px 14px" }}>
        {config.widgets.gravTrace.enabled && (
          <div style={{ opacity: config.widgets.gravTrace.opacity }}>
            <GravTrace value={state.player.gravFieldStrength} opacity={opacity} />
          </div>
        )}
        <div style={{ marginTop: 6, color: "rgba(180,205,228,0.72)", fontSize: 11, letterSpacing: "0.14em" }}>GRAV. FIELD</div>
        <div style={{ color: "rgba(248,208,145,0.96)", fontSize: 18, marginTop: 2 }}>{state.player.gravFieldStrength.toFixed(2)}</div>

        <div style={{ marginTop: 4, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240, height: 240, flex: "0 0 auto", transform: `scale(${config.widgets.shields.scale})` }}>
            <div style={{ position: "absolute", inset: 0, opacity: config.widgets.shields.opacity }}>
              <RingGauge size={240} valuePct={state.player.shieldsPct} track="rgba(180,220,255,0.14)" color={shield} glow={shield} strokeWidth={12} />
            </div>
            <div style={{ position: "absolute", inset: 16, opacity: config.widgets.fuel.opacity, transform: `scale(${config.widgets.fuel.scale})` }}>
              <RingGauge size={208} valuePct={state.player.fuelPct} startDeg={-30} sweepDeg={220} track="rgba(180,220,255,0.08)" color={fuel} glow={fuel} strokeWidth={12} />
            </div>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <div style={{ fontSize: 52, color: "rgba(182,255,222,0.6)", lineHeight: 1 }}>⬰</div>
              <div style={{ marginTop: 6, fontSize: 11, letterSpacing: "0.12em", color: "rgba(190,210,235,0.58)" }}>PRIMARY SCREEN</div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 10 }}>
              <BigReadout label="SHD" value={`${state.player.shieldsPct.toFixed(0)}%`} accent={shield} />
              <BigReadout label="FUEL" value={`${state.player.fuelPct.toFixed(0)}%`} accent={fuel} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              <SmallMetric label="HITS REM" value={`${state.player.hitsRemaining}`} />
              <SmallMetric label="SPD" value={state.player.speed.toFixed(1)} />
              <SmallMetric label="DRFT" value={`${state.player.driftSpeed.toFixed(1)}m/s`} />
              <SmallMetric label="TRIM" value={`${state.player.trimDeg >= 0 ? "+" : ""}${state.player.trimDeg.toFixed(1)}°`} />
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "rgba(175,205,228,0.82)" }}>THERM. ○○  &nbsp;&nbsp; PHASE: <span style={{ color: "rgba(210,235,255,0.94)" }}>{state.player.phaseState}</span></div>
          </div>
        </div>
      </div>
    </PanelFrame>
  );
}

function BigReadout({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <div style={{ color: "rgba(180,205,228,0.66)", fontSize: 11, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ marginTop: 4, color: accent, fontSize: 34, textShadow: `0 0 12px ${accent}` }}>{value}</div>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(180,220,255,0.08)", borderRadius: 12, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ color: "rgba(175,205,228,0.62)", fontSize: 10 }}>{label}</div>
      <div style={{ marginTop: 4, color: "rgba(230,240,248,0.96)", fontSize: 16 }}>{value}</div>
    </div>
  );
}
