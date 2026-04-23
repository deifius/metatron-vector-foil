import type { ScoreThresholdTable } from "../types/scoring";

export const SCORE_THRESHOLDS: ScoreThresholdTable = {
  longShotDistance: 900,
  extremeLongShotDistance: 1400,
  salvoWindowMs: 1400,
  firstRoundWindowMs: 250,
  stableOrbitSeconds: 10,
  advancedOrbitSeconds: 20,
  highGTurn: 5.5,
  extremeGTurn: 8.0,
  oortReachRadius: 1600,
  farOortReachRadius: 2400,
  deadstickFuelPct: 0.1,
  returnToBurnOuterRadius: 1500,
  returnToBurnInnerRadius: 900,
  chainDecayMs: 4000,
  chainDamagePenalty: 0.5,
  chainAddPerFeat: 0.2,
  chainCategoryBonus: 0.1,
  chainMax: 4.0,
};
