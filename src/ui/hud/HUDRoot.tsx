import React from "react";
import { DEFAULT_HUD_CONFIG } from "./hudConfig";
import { HUDConfig, HUDState } from "./hudTypes";
import { AlertBanner } from "./widgets/AlertBanner";
import { ShipStatusCluster } from "./widgets/ShipStatusCluster";
import { TacticalCluster } from "./widgets/TacticalCluster";
import { TacticalPlotCluster } from "./widgets/TacticalPlotCluster";

function clusterStyle(anchor: React.CSSProperties, globalScale: number, clusterScale: number, opacity: number): React.CSSProperties {
  return {
    ...anchor,
    transformOrigin: "top left",
    transform: `scale(${globalScale * clusterScale})`,
    opacity,
  };
}

export function HUDRoot({
  state,
  config = DEFAULT_HUD_CONFIG,
}: {
  state: HUDState;
  config?: HUDConfig;
}) {
  if (!config.enabled) return null;
  return (
    <>
      <style>{`
        @keyframes hudPulse {
          0%, 100% { opacity: 0.88; }
          50% { opacity: 1; }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: config.pointerEvents,
          fontFamily: "ui-monospace, Menlo, monospace",
          color: "rgba(240,245,250,0.95)",
          opacity: config.opacity,
          zIndex: 3,
        }}
      >
        {config.alertBanner.enabled && (
          <AlertBanner
            alert={state.alert}
            title={state.title}
            controlsText={state.controlsText}
            opacity={config.alertBanner.opacity}
            style={clusterStyle(config.alertBanner.anchor, config.scale, config.alertBanner.scale, config.alertBanner.opacity)}
          />
        )}
        {config.tacticalCluster.enabled && (
          <TacticalCluster
            state={state}
            config={config}
            opacity={config.tacticalCluster.opacity}
            style={clusterStyle(config.tacticalCluster.anchor, config.scale, config.tacticalCluster.scale, config.tacticalCluster.opacity)}
          />
        )}
        {config.shipCluster.enabled && (
          <ShipStatusCluster
            state={state}
            config={config}
            opacity={config.shipCluster.opacity}
            style={clusterStyle(config.shipCluster.anchor, config.scale, config.shipCluster.scale, config.shipCluster.opacity)}
          />
        )}
        {config.plotCluster.enabled && (
          <TacticalPlotCluster
            state={state}
            config={config}
            opacity={config.plotCluster.opacity}
            style={clusterStyle(config.plotCluster.anchor, config.scale, config.plotCluster.scale, config.plotCluster.opacity)}
          />
        )}
      </div>
    </>
  );
}
