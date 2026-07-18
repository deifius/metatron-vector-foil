export type GamepadControlProfile = "none" | "modern-standard" | "legacy-nes" | "generic-digital";

export type ShipControllerInput = {
  rotate: number;
  thrust: number;
  brake: number;
  fire: boolean;
  firePressed: boolean;
  pausePressed: boolean;
  connected: boolean;
  profile: GamepadControlProfile;
  label: string;
  gamepadIndex: number | null;
};

export type ConnectedGamepadDescriptor = {
  index: number;
  id: string;
  label: string;
  mapping: GamepadMappingType | "";
  profile: GamepadControlProfile;
  buttons: number;
  axes: number;
  active: boolean;
};

export const GAMEPAD_CONFIG = {
  enabled: true,

  modern: {
    deadzone: 0.12,
    rotationAxis: 0,
    rotationCurve: 1.35,
    rotationScale: 1.0,

    thrustButton: 7,
    thrustCurve: 1.15,

    brakeButton: 6,
    brakeCurve: 1.1,

    fireButtons: [0],
    pauseButtons: [9],
  },

  legacy: {
    deadzone: 0.34,
    rotationSlew: 10,
    thrustSlew: 12,
    brakeSlew: 14,

    dpadUpButton: 12,
    dpadDownButton: 13,
    dpadLeftButton: 14,
    dpadRightButton: 15,

    fireButtons: [0],
    brakeButtons: [1],
    pauseButtons: [9, 8, 3],
  },
} as const;

const EMPTY_INPUT: ShipControllerInput = {
  rotate: 0,
  thrust: 0,
  brake: 0,
  fire: false,
  firePressed: false,
  pausePressed: false,
  connected: false,
  profile: "none",
  label: "",
  gamepadIndex: null,
};

type DigitalPadState = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

type LegacySmoothState = {
  rotate: number;
  thrust: number;
  brake: number;
};

let activeGamepadIndex: number | null = null;
let previousButtons = new Map<number, boolean[]>();
let legacySmooth = new Map<number, LegacySmoothState>();

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function approach(current: number, target: number, maxStep: number) {
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return current;
}

function buttonValue(gamepad: Gamepad, index: number | undefined) {
  if (index === undefined || index < 0) return 0;
  const button = gamepad.buttons[index];
  if (!button) return 0;
  return clamp(Math.max(button.value ?? 0, button.pressed ? 1 : 0), 0, 1);
}

function buttonPressed(gamepad: Gamepad, index: number | undefined) {
  return buttonValue(gamepad, index) >= 0.5;
}

function anyButtonPressed(gamepad: Gamepad, indexes: readonly number[]) {
  return indexes.some((index) => buttonPressed(gamepad, index));
}

function axisValue(gamepad: Gamepad, index: number | undefined) {
  if (index === undefined || index < 0) return 0;
  const v = gamepad.axes[index] ?? 0;
  return Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

function axisNegative(gamepad: Gamepad, index: number, deadzone: number) {
  return axisValue(gamepad, index) <= -deadzone;
}

function axisPositive(gamepad: Gamepad, index: number, deadzone: number) {
  return axisValue(gamepad, index) >= deadzone;
}

function shapeAxis(value: number, deadzone: number, curve: number) {
  const mag = Math.abs(value);
  if (mag < deadzone) return 0;
  const normalized = clamp((mag - deadzone) / Math.max(0.0001, 1 - deadzone), 0, 1);
  return Math.sign(value) * Math.pow(normalized, curve);
}

function shapeButton(value: number, curve: number) {
  return Math.pow(clamp(value, 0, 1), curve);
}

function currentButtons(gamepad: Gamepad) {
  return gamepad.buttons.map((button) => Boolean(button.pressed || button.value >= 0.5));
}

function wasPressed(gamepad: Gamepad, indexes: readonly number[]) {
  const prev = previousButtons.get(gamepad.index) ?? [];
  const now = currentButtons(gamepad);
  return indexes.some((index) => Boolean(now[index]) && !Boolean(prev[index]));
}

function updatePreviousButtons(gamepad: Gamepad) {
  previousButtons.set(gamepad.index, currentButtons(gamepad));
}

function gamepadHasActivity(gamepad: Gamepad) {
  const activeAxis = gamepad.axes.some((v) => Math.abs(Number.isFinite(v) ? v : 0) > 0.2);
  const activeButton = gamepad.buttons.some((button) => button.pressed || button.value > 0.2);
  return activeAxis || activeButton;
}

function getGamepads() {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
  return Array.from(navigator.getGamepads()).filter((gamepad): gamepad is Gamepad => Boolean(gamepad && gamepad.connected));
}

function pickGamepad() {
  const pads = getGamepads();
  if (pads.length === 0) {
    activeGamepadIndex = null;
    previousButtons.clear();
    legacySmooth.clear();
    return null;
  }

  const active = pads.find(gamepadHasActivity);
  if (active) {
    activeGamepadIndex = active.index;
    return active;
  }

  const current = activeGamepadIndex === null ? null : pads.find((gamepad) => gamepad.index === activeGamepadIndex);
  if (current) return current;

  activeGamepadIndex = pads[0].index;
  return pads[0];
}

function detectProfile(gamepad: Gamepad): GamepadControlProfile {
  const hasStandardModernShape = gamepad.mapping === "standard" && gamepad.axes.length >= 4 && gamepad.buttons.length >= 16;
  if (hasStandardModernShape) return "modern-standard";

  const looksLikeNesPad = gamepad.axes.length <= 2 && gamepad.buttons.length <= 10;
  if (looksLikeNesPad) return "legacy-nes";

  return "generic-digital";
}

function readDigitalDpad(gamepad: Gamepad): DigitalPadState {
  const cfg = GAMEPAD_CONFIG.legacy;

  const left = buttonPressed(gamepad, cfg.dpadLeftButton) || axisNegative(gamepad, 0, cfg.deadzone);
  const right = buttonPressed(gamepad, cfg.dpadRightButton) || axisPositive(gamepad, 0, cfg.deadzone);
  const up = buttonPressed(gamepad, cfg.dpadUpButton) || axisNegative(gamepad, 1, cfg.deadzone);
  const down = buttonPressed(gamepad, cfg.dpadDownButton) || axisPositive(gamepad, 1, cfg.deadzone);

  return { left, right, up, down };
}

function readLegacyInput(gamepad: Gamepad, dt: number) {
  const cfg = GAMEPAD_CONFIG.legacy;
  const dpad = readDigitalDpad(gamepad);
  const smooth = legacySmooth.get(gamepad.index) ?? { rotate: 0, thrust: 0, brake: 0 };

  const rotateTarget = (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  const thrustTarget = dpad.up ? 1 : 0;
  const brakeTarget = dpad.down || anyButtonPressed(gamepad, cfg.brakeButtons) ? 1 : 0;
  const safeDt = clamp(dt, 0, 0.1);

  smooth.rotate = approach(smooth.rotate, rotateTarget, cfg.rotationSlew * safeDt);
  smooth.thrust = approach(smooth.thrust, thrustTarget, cfg.thrustSlew * safeDt);
  smooth.brake = approach(smooth.brake, brakeTarget, cfg.brakeSlew * safeDt);
  legacySmooth.set(gamepad.index, smooth);

  return { rotate: smooth.rotate, thrust: smooth.thrust, brake: smooth.brake };
}

function readModernInput(gamepad: Gamepad, dt: number) {
  const cfg = GAMEPAD_CONFIG.modern;
  const legacy = readLegacyInput(gamepad, dt);
  const analogRotate = shapeAxis(axisValue(gamepad, cfg.rotationAxis), cfg.deadzone, cfg.rotationCurve) * cfg.rotationScale;
  const analogThrust = shapeButton(buttonValue(gamepad, cfg.thrustButton), cfg.thrustCurve);
  const analogBrake = shapeButton(buttonValue(gamepad, cfg.brakeButton), cfg.brakeCurve);

  return {
    rotate: Math.abs(analogRotate) > 0.001 ? analogRotate : legacy.rotate,
    thrust: Math.max(analogThrust, legacy.thrust),
    brake: Math.max(analogBrake, legacy.brake),
  };
}

function readGamepad(gamepad: Gamepad, dt: number): ShipControllerInput {
  const profile = detectProfile(gamepad);
  const motion = profile === "modern-standard" ? readModernInput(gamepad, dt) : readLegacyInput(gamepad, dt);

  const fireButtons = profile === "modern-standard" ? GAMEPAD_CONFIG.modern.fireButtons : GAMEPAD_CONFIG.legacy.fireButtons;
  const pauseButtons = profile === "modern-standard" ? GAMEPAD_CONFIG.modern.pauseButtons : GAMEPAD_CONFIG.legacy.pauseButtons;

  const input: ShipControllerInput = {
    rotate: clamp(motion.rotate, -1, 1),
    thrust: clamp(motion.thrust, 0, 1),
    brake: clamp(motion.brake, 0, 1),
    fire: anyButtonPressed(gamepad, fireButtons),
    firePressed: wasPressed(gamepad, fireButtons),
    pausePressed: wasPressed(gamepad, pauseButtons),
    connected: true,
    profile,
    label: gamepad.id || "Gamepad",
    gamepadIndex: gamepad.index,
  };

  updatePreviousButtons(gamepad);
  return input;
}

export function getConnectedGamepadDescriptors(): ConnectedGamepadDescriptor[] {
  return getGamepads()
    .sort((a, b) => a.index - b.index)
    .map((gamepad) => ({
      index: gamepad.index,
      id: gamepad.id || `Gamepad ${gamepad.index + 1}`,
      label: gamepad.id || `Gamepad ${gamepad.index + 1}`,
      mapping: gamepad.mapping,
      profile: detectProfile(gamepad),
      buttons: gamepad.buttons.length,
      axes: gamepad.axes.length,
      active: gamepadHasActivity(gamepad),
    }));
}

export function readGamepadShipInputForIndex(index: number | null | undefined, dt = 1 / 60): ShipControllerInput {
  if (!GAMEPAD_CONFIG.enabled || index === null || index === undefined) return { ...EMPTY_INPUT };
  const gamepad = getGamepads().find((candidate) => candidate.index === index);
  if (!gamepad) return { ...EMPTY_INPUT, gamepadIndex: index };
  return readGamepad(gamepad, dt);
}

export function readGamepadShipInput(dt = 1 / 60): ShipControllerInput {
  if (!GAMEPAD_CONFIG.enabled) return { ...EMPTY_INPUT };
  const gamepad = pickGamepad();
  if (!gamepad) return { ...EMPTY_INPUT };
  return readGamepad(gamepad, dt);
}

export function resetGamepadEdgeState(index?: number) {
  if (index === undefined) {
    previousButtons.clear();
    legacySmooth.clear();
    activeGamepadIndex = null;
    return;
  }
  previousButtons.delete(index);
  legacySmooth.delete(index);
  if (activeGamepadIndex === index) activeGamepadIndex = null;
}

export function getGamepadControlsHint(input: ShipControllerInput) {
  if (!input.connected) return "A/D rotate · W thrust · S brake · Space shoot · Enter launch · P pause · M/T/B toggles";
  if (input.profile === "modern-standard") return "Left stick rotate · RT thrust · LT brake · A/Cross shoot · Start pause";
  return "D-pad steer/thrust/brake · A shoot · B brake · Start pause";
}
