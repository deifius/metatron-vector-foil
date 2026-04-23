import type {
  CitationScoreTable,
  EnemyScoreTable,
  WaveScoreTable,
} from "../types/scoring";

export const ENEMY_SCORE: EnemyScoreTable = {
  tetrahedron: 100,
  cube: 200,
  octahedron: 350,
  dodecahedron: 600,
  icosahedron: 1000,
  shrapnelBonus: 50,
  nearSolBonus: 150,
  clutchDefenseBonus: 250,
  multiKillExtra: 100,
};

export const CITATION_SCORE: CitationScoreTable = {
  longShot: 250,
  extremeLongShot: 600,
  firstRoundHit: 200,
  salvoConnect: 400,
  fullSalvo: 900,
  leadComputed: 350,
  cascadeStrike: 500,
  scripturalShrapnel: 800,
  vectorDiscipline: 300,
  stableOrbit: 600,
  periapsisKiss: 500,
  highGTurn: 700,
  extremeGTurn: 1400,
  slingshot: 800,
  hotInsertion: 450,
  oortReach: 500,
  farOortReach: 1200,
  escapeAndReturn: 1500,
  returnToTheBurn: 700,
  deadstickReturn: 1200,
  threadTheNeedle: 650,
  impossibleRecovery: 1800,
  nodeAwakened: 1500,
  nodeRekindled: 400,
  pathIllumined: 2500,
  outerRingSanctified: 3500,
  innerMysteryAwakened: 5000,
  allSpheresLit: 10000,
  corsairDescentAuthorized: 15000,
};

export const WAVE_SCORE: WaveScoreTable = {
  clearBaseMultiplier: 500,
  perfectWaveMultiplier: 750,
  solProtectedMultiplier: 500,
  efficientWaveMultiplier: 300,
  noDriftClearMultiplier: 400,
  lastStandClearMultiplier: 1000,
};

export function scoreForEnemy(kind: keyof Pick<EnemyScoreTable, "tetrahedron" | "cube" | "octahedron" | "dodecahedron" | "icosahedron">): number {
  return ENEMY_SCORE[kind];
}

export function scoreForCitation(id: keyof CitationScoreTable): number {
  return CITATION_SCORE[id];
}

export function scoreForWaveClear(waveNumber: number): number {
  return WAVE_SCORE.clearBaseMultiplier * Math.max(1, waveNumber);
}

export function scoreForPerfectWave(waveNumber: number): number {
  return WAVE_SCORE.perfectWaveMultiplier * Math.max(1, waveNumber);
}
