import { HUDConfig, HUDState } from "./hudTypes";

export const DEFAULT_HUD_CONFIG: HUDConfig = {
  enabled: true,
  scale: 1,
  opacity: 0.96,
  pointerEvents: "none",
  safeMarginPx: 18,
  animationStrength: 0.85,
  decorativeIntensity: 0.72,
  alertBanner: {
    enabled: true,
    scale: 1,
    opacity: 0.96,
    anchor: { top: 18, left: 18, width: "min(42vw, 560px)" },
  },
  tacticalCluster: {
    enabled: true,
    scale: 1,
    opacity: 0.95,
    anchor: { top: 18, right: 18, width: "min(28vw, 360px)" },
  },
  shipCluster: {
    enabled: true,
    scale: 1,
    opacity: 0.94,
    anchor: { left: 18, bottom: 18, width: "min(32vw, 430px)" },
  },
  plotCluster: {
    enabled: true,
    scale: 1,
    opacity: 0.9,
    anchor: { right: 18, bottom: 18, width: "min(24vw, 320px)" },
  },
  widgets: {
    radar: { enabled: true, scale: 1, opacity: 0.92 },
    shields: { enabled: true, scale: 1, opacity: 1 },
    fuel: { enabled: true, scale: 1, opacity: 0.96 },
    gravTrace: { enabled: true, scale: 1, opacity: 0.78 },
    tacticalPlot: { enabled: true, scale: 1, opacity: 0.84 },
    numericReadouts: { enabled: true, scale: 1, opacity: 0.95 },
  },
};

export const DEFAULT_HUD_STATE: HUDState = {
  title: "Metatron Vector FOIL",
  controlsText: "A/D rotate · W/S trim · Space shoot · Enter start · P pause · M/T/B toggles",
  alert: { text: "STANDING BY", severity: "info" },
  player: {
    shieldsPct: 100,
    fuelPct: 100,
    hitsRemaining: 6,
    speed: 0,
    driftSpeed: 0,
    trimDeg: 0,
    gravFieldStrength: 0,
    phaseState: "STABLE",
  },
  tactical: {
    waveNumber: 1,
    currentEnemyLabel: "CUBE",
    incomingCount: 0,
    bullets: 0,
    enemies: 0,
    shards: 0,
    closureRate: 0,
    nearestRange: 0,
  },
  radar: {
    contacts: [],
    placeholderSweepDeg: 0,
    enabled: true,
  },
};
