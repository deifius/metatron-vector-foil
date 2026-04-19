import React from "react";

export type HUDSeverity = "info" | "warning" | "critical";

export type HUDAlert = {
  text: string;
  severity: HUDSeverity;
  flashing?: boolean;
};

export type HUDRadarContact = {
  bearingRad: number;
  distanceNorm: number;
  kind: string;
  threat: number;
};

export type HUDState = {
  title: string;
  controlsText: string;
  alert: HUDAlert;
  player: {
    shieldsPct: number;
    fuelPct: number;
    hitsRemaining: number;
    speed: number;
    driftSpeed: number;
    trimDeg: number;
    gravFieldStrength: number;
    phaseState: string;
  };
  tactical: {
    waveNumber: number;
    currentEnemyLabel: string;
    incomingCount: number;
    bullets: number;
    enemies: number;
    shards: number;
    closureRate: number;
    nearestRange: number;
  };
  radar: {
    contacts: HUDRadarContact[];
    placeholderSweepDeg: number;
    enabled: boolean;
  };
};

export type HUDWidgetConfig = {
  enabled: boolean;
  scale: number;
  opacity: number;
};

export type HUDClusterConfig = HUDWidgetConfig & {
  anchor: React.CSSProperties;
};

export type HUDConfig = {
  enabled: boolean;
  scale: number;
  opacity: number;
  pointerEvents: "none" | "auto";
  safeMarginPx: number;
  animationStrength: number;
  decorativeIntensity: number;
  alertBanner: HUDClusterConfig;
  tacticalCluster: HUDClusterConfig;
  shipCluster: HUDClusterConfig;
  plotCluster: HUDClusterConfig;
  widgets: {
    radar: HUDWidgetConfig;
    shields: HUDWidgetConfig;
    fuel: HUDWidgetConfig;
    gravTrace: HUDWidgetConfig;
    tacticalPlot: HUDWidgetConfig;
    numericReadouts: HUDWidgetConfig;
  };
};
