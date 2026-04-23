export type CitationCategory = "destruction" | "gunnery" | "pilotage" | "geometry" | "wave";

export interface EnemyScoreTable {
  tetrahedron: number;
  cube: number;
  octahedron: number;
  dodecahedron: number;
  icosahedron: number;
  shrapnelBonus: number;
  nearSolBonus: number;
  clutchDefenseBonus: number;
  multiKillExtra: number;
}

export interface CitationScoreTable {
  longShot: number;
  extremeLongShot: number;
  firstRoundHit: number;
  salvoConnect: number;
  fullSalvo: number;
  leadComputed: number;
  cascadeStrike: number;
  scripturalShrapnel: number;
  vectorDiscipline: number;
  stableOrbit: number;
  periapsisKiss: number;
  highGTurn: number;
  extremeGTurn: number;
  slingshot: number;
  hotInsertion: number;
  oortReach: number;
  farOortReach: number;
  escapeAndReturn: number;
  returnToTheBurn: number;
  deadstickReturn: number;
  threadTheNeedle: number;
  impossibleRecovery: number;
  nodeAwakened: number;
  nodeRekindled: number;
  pathIllumined: number;
  outerRingSanctified: number;
  innerMysteryAwakened: number;
  allSpheresLit: number;
  corsairDescentAuthorized: number;
}

export interface WaveScoreTable {
  clearBaseMultiplier: number;
  perfectWaveMultiplier: number;
  solProtectedMultiplier: number;
  efficientWaveMultiplier: number;
  noDriftClearMultiplier: number;
  lastStandClearMultiplier: number;
}

export interface ScoreThresholdTable {
  longShotDistance: number;
  extremeLongShotDistance: number;
  salvoWindowMs: number;
  firstRoundWindowMs: number;
  stableOrbitSeconds: number;
  advancedOrbitSeconds: number;
  highGTurn: number;
  extremeGTurn: number;
  oortReachRadius: number;
  farOortReachRadius: number;
  deadstickFuelPct: number;
  returnToBurnOuterRadius: number;
  returnToBurnInnerRadius: number;
  chainDecayMs: number;
  chainDamagePenalty: number;
  chainAddPerFeat: number;
  chainCategoryBonus: number;
  chainMax: number;
}

export interface CommendationDefinition {
  id: keyof CitationScoreTable;
  category: Exclude<CitationCategory, "destruction" | "wave">;
  label: string;
  subtitle?: string;
  tier: 1 | 2 | 3;
}
