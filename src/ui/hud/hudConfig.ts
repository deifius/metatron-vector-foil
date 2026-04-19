import { HUDConfig, HUDState } from "./hudTypes";

// ===================== HUD DEV CONTROLS =====================
// Keep the main tweak points here so the GUI_HUD branch is easy to tune.
export const HUD_DEV_CONTROLS = {
  refreshHz: 15,
  globalScale: 0.8,
  globalOpacity: 0.92,
  pointerEvents: "none" as const,
  safeMarginPx: 18,
  animationStrength: 0.65,
  decorativeIntensity: 0.48,

  clusters: {
    alertBanner: {
      enabled: true,
      scale: 1,
      opacity: 0.9,
      anchor: { right: 18, bottom: 18, width: "min(28vw, 360px)" },
    },
    tacticalCluster: {
      enabled: true,
      scale: 1,
      opacity: 0.92,
      anchor: { top: 18, right: 18, width: "min(22vw, 300px)" },
    },
    shipCluster: {
      enabled: true,
      scale: 1,
      opacity: 0.9,
      anchor: { left: 18, bottom: 18, width: "min(26vw, 350px)" },
    },
    plotCluster: {
      enabled: true,
      scale: 1,
      opacity: 0.82,
      anchor: { top: 18, left: 18, width: "min(18vw, 250px)" },
    },
  },

  widgets: {
    radar: { enabled: true, scale: 1, opacity: 0.86 },
    shields: { enabled: true, scale: 1, opacity: 0.96 },
    fuel: { enabled: true, scale: 1, opacity: 0.9 },
    gravTrace: { enabled: true, scale: 1, opacity: 0.6 },
    tacticalPlot: { enabled: true, scale: 1, opacity: 0.72 },
    numericReadouts: { enabled: true, scale: 1, opacity: 0.94 },
  },
};

export const DEFAULT_HUD_CONFIG: HUDConfig = {
  enabled: true,
  scale: HUD_DEV_CONTROLS.globalScale,
  opacity: HUD_DEV_CONTROLS.globalOpacity,
  pointerEvents: HUD_DEV_CONTROLS.pointerEvents,
  safeMarginPx: HUD_DEV_CONTROLS.safeMarginPx,
  animationStrength: HUD_DEV_CONTROLS.animationStrength,
  decorativeIntensity: HUD_DEV_CONTROLS.decorativeIntensity,
  alertBanner: HUD_DEV_CONTROLS.clusters.alertBanner,
  tacticalCluster: HUD_DEV_CONTROLS.clusters.tacticalCluster,
  shipCluster: HUD_DEV_CONTROLS.clusters.shipCluster,
  plotCluster: HUD_DEV_CONTROLS.clusters.plotCluster,
  widgets: HUD_DEV_CONTROLS.widgets,
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
