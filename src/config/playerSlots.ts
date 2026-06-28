export const MAX_MULTIPLAYER_PLAYERS = 4 as const;
export const LOCAL_SOLO_PLAYER_ID = "solo-0" as const;

export type PlayerId = string;
export type MultiplayerRole = "host" | "guest" | "solo";
export type PlayerSlotIndex = 0 | 1 | 2 | 3;
export type PlayerLifeState = "alive" | "dead" | "respawn-pending" | "disconnected";

export type MetatronPlayerSlot = {
  id: PlayerId;
  slot: PlayerSlotIndex;
  role: MultiplayerRole;
  callsign?: string | null;
  lifeState: PlayerLifeState;
  connected: boolean;
  lastInputSeq: number;
  joinedAtMs: number;
};

export function createLocalPlayerSlot(callsign?: string | null): MetatronPlayerSlot {
  return {
    id: LOCAL_SOLO_PLAYER_ID,
    slot: 0,
    role: "solo",
    callsign: callsign ?? null,
    lifeState: "alive",
    connected: true,
    lastInputSeq: 0,
    joinedAtMs: Date.now(),
  };
}

export function createEmptyPlayerRegistry(callsign?: string | null) {
  return [createLocalPlayerSlot(callsign)] as MetatronPlayerSlot[];
}

export function createPlayerRegistryWithLocal(id: PlayerId, role: MultiplayerRole, callsign?: string | null) {
  const slot = createLocalPlayerSlot(callsign);
  slot.id = id;
  slot.role = role;
  return [slot] as MetatronPlayerSlot[];
}

export function assignNextPlayerSlot(players: MetatronPlayerSlot[], id: PlayerId, role: MultiplayerRole, callsign?: string | null) {
  const used = new Set(players.map((player) => player.slot));
  for (let slot = 0; slot < MAX_MULTIPLAYER_PLAYERS; slot += 1) {
    if (used.has(slot as PlayerSlotIndex)) continue;
    const player: MetatronPlayerSlot = {
      id,
      slot: slot as PlayerSlotIndex,
      role,
      callsign: callsign ?? null,
      lifeState: "alive",
      connected: true,
      lastInputSeq: 0,
      joinedAtMs: Date.now(),
    };
    players.push(player);
    return player;
  }
  return null;
}

export function markPlayerDestroyed(player: MetatronPlayerSlot) {
  player.lifeState = "respawn-pending";
}

export function markPlayerRespawned(player: MetatronPlayerSlot) {
  player.lifeState = "alive";
}

export function connectedPlayers(players: MetatronPlayerSlot[]) {
  return players.filter((player) => player.connected && player.lifeState !== "disconnected");
}

export function alivePlayers(players: MetatronPlayerSlot[]) {
  return connectedPlayers(players).filter((player) => player.lifeState === "alive");
}

export function playerSlotSummary(players: MetatronPlayerSlot[]) {
  return players.map((player) => ({
    id: player.id,
    slot: player.slot,
    role: player.role,
    lifeState: player.lifeState,
    connected: player.connected,
    lastInputSeq: player.lastInputSeq,
  }));
}

export function isPlayerAlive(player: MetatronPlayerSlot | undefined | null) {
  return !!player && player.connected && player.lifeState === "alive";
}

export function isPlayerRespawnPending(player: MetatronPlayerSlot | undefined | null) {
  return !!player && player.connected && player.lifeState === "respawn-pending";
}

export function respawnPendingPlayers(players: MetatronPlayerSlot[]) {
  return connectedPlayers(players).filter((player) => player.lifeState === "respawn-pending");
}

export function shouldEndRunForPlayerLoss(players: MetatronPlayerSlot[]) {
  const connected = connectedPlayers(players);
  return connected.length > 0 && alivePlayers(connected).length === 0;
}
