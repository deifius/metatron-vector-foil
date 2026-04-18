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

function GraviticTrace({ value, opacity }: { value: number; opacity: number }) {
  const width = 220;
  const height = 44;
  const points = Array.from({ length: 28 }, (_, i) => {
    const x = (i / 27) * width;
    const wave = Math.sin(i * 0.56 + value * 0.13) * (4 + Math.min(10, value * 0.02));
    const jitter = Math.cos(i * 1.33 + value * 0.04) * 2.4;
    const y = height / 2 + wave + jitter;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline fill="none" stroke={`rgba(255, 228, 162, ${0.8 * opacity})`} strokeWidth="1.6" points={points} />
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={`rgba(180,220,255,${0.1 * opacity})`} strokeWidth="1" />
    </svg>
  );
}

function RadialReadout({
  label,
  value,
  x,
  y,
  align = "center",
}: {
  label: string;
  value: string;
  x: number;
  y: number;
  align?: React.CSSProperties["textAlign"];
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        textAlign: align,
        minWidth: 48,
      }}
    >
      <div style={{ color: "rgba(175,205,228,0.64)", fontSize: 9, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ marginTop: 2, color: "rgba(230,240,248,0.96)", fontSize: 14 }}>{value}</div>
    </div>
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
  const circleSize = 238;

  return (
    <PanelFrame opacity={opacity} style={style}>
      <div style={{ width: 248, padding: "2px 4px 0 4px" }}>
        <div style={{ width: 184, marginLeft: 20, opacity: config.widgets.gravTrace.opacity }}>
          <div style={{ color: "rgba(180,205,228,0.72)", fontSize: 10, letterSpacing: "0.14em" }}>GRAV. FIELD</div>
          <div style={{ color: "rgba(248,208,145,0.96)", fontSize: 18, marginTop: 1 }}>{state.player.gravFieldStrength.toFixed(2)}</div>
          {config.widgets.gravTrace.enabled && <GraviticTrace value={state.player.gravFieldStrength} opacity={opacity} />}
          <div style={{ marginTop: -2, color: "rgba(175,205,228,0.56)", fontSize: 9, letterSpacing: "0.12em" }}>GRAVITIC TRACE</div>
        </div>

        <div style={{ position: "relative", width: circleSize, height: circleSize, marginTop: -4 }}>
          <div style={{ position: "absolute", inset: 0, opacity: config.widgets.shields.opacity }}>
            <RingGauge size={circleSize} valuePct={state.player.shieldsPct} track="rgba(180,220,255,0.12)" color={shield} glow={shield} strokeWidth={12} />
          </div>
          <div style={{ position: "absolute", inset: 18, opacity: config.widgets.fuel.opacity, transform: `scale(${config.widgets.fuel.scale})` }}>
            <RingGauge size={circleSize - 36} valuePct={state.player.fuelPct} startDeg={-28} sweepDeg={220} track="rgba(180,220,255,0.08)" color={fuel} glow={fuel} strokeWidth={10} />
          </div>

          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 124, height: 124, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <div style={{ position: "absolute", top: 18, left: 18 }}>
                <div style={{ color: "rgba(175,205,228,0.6)", fontSize: 10, letterSpacing: "0.08em" }}>SHD</div>
                <div style={{ marginTop: 2, color: shield, fontSize: 19, textShadow: `0 0 10px ${shield}` }}>{state.player.shieldsPct.toFixed(0)}%</div>
              </div>
              <div style={{ position: "absolute", top: 18, right: 8, textAlign: "right" }}>
                <div style={{ color: "rgba(175,205,228,0.6)", fontSize: 10, letterSpacing: "0.08em" }}>FUEL</div>
                <div style={{ marginTop: 2, color: fuel, fontSize: 19, textShadow: `0 0 10px ${fuel}` }}>{state.player.fuelPct.toFixed(0)}%</div>
              </div>
              <div style={{ fontSize: 40, color: "rgba(182,255,222,0.58)", lineHeight: 1 }}>⬰</div>
              <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", color: "rgba(175,205,228,0.68)", fontSize: 9, letterSpacing: "0.12em" }}>
                PHASE: {state.player.phaseState}
              </div>
            </div>
          </div>

          <RadialReadout label="SPD" value={state.player.speed.toFixed(1)} x={226} y={46} />
          <RadialReadout label="DRFT" value={`${state.player.driftSpeed.toFixed(1)}m/s`} x={244} y={172} />
          <RadialReadout label="TRIM" value={`${state.player.trimDeg >= 0 ? "+" : ""}${state.player.trimDeg.toFixed(1)}°`} x={154} y={226} />
          <RadialReadout label="HITS" value={`${state.player.hitsRemaining}`} x={30} y={202} />
        </div>
      </div>
    </PanelFrame>
  );
}
