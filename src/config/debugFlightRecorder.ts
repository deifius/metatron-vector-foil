export type DebugRole = "host" | "guest" | "solo";
export type DebugSeverity = "debug" | "info" | "warn" | "error";
export type DebugCategory =
  | "lifecycle"
  | "input"
  | "network"
  | "snapshot"
  | "collision"
  | "projectile"
  | "shrapnel"
  | "enemy"
  | "wave"
  | "player"
  | "audio"
  | "render"
  | "config"
  | "error";

export type DebugLogEvent = {
  t: number;
  iso: string;
  sessionId: string;
  playerId?: string;
  callsign?: string | null;
  role: DebugRole;
  level: DebugSeverity;
  category: DebugCategory;
  event: string;
  data?: Record<string, unknown>;
};

export type FlightRecorderContext = {
  sessionId: string;
  role: DebugRole;
  playerId?: string;
  callsign?: string | null;
  buildLabel?: string;
};

export type DebugBundle = {
  game: "Metatron Vector Foil";
  recorder: "Metatron Flight Recorder";
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  context: FlightRecorderContext;
  client: {
    userAgent: string;
    language: string;
    viewport: {
      width: number;
      height: number;
      devicePixelRatio: number;
    };
  };
  summary: {
    eventCount: number;
    warnCount: number;
    errorCount: number;
    incidentCount: number;
    firstEventAt?: string;
    lastEventAt?: string;
  };
  extra?: Record<string, unknown>;
  recentEvents: DebugLogEvent[];
};

const DEBUG_LOG_MAX_EVENTS = 5000;
const DEBUG_LOG_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_DATA_DEPTH = 5;
const MAX_STRING_LENGTH = 600;
const MAX_ARRAY_LENGTH = 80;
const REDACTED = "[redacted]";

const events: DebugLogEvent[] = [];
let incidentCount = 0;
let errorCaptureInstalled = false;

function makeSessionId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && "randomUUID" in cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `mvf-${cryptoApi.randomUUID()}`;
  }
  const rnd = Math.random().toString(36).slice(2, 10);
  return `mvf-${Date.now().toString(36)}-${rnd}`;
}

let context: FlightRecorderContext = {
  sessionId: makeSessionId(),
  role: "solo",
  playerId: "solo-0",
  callsign: null,
};

function shouldRedactKey(key: string) {
  return /token|csrf|secret|password|cookie|authorization|oauth|email|session|credential/i.test(key);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DATA_DEPTH) return "[depth-limit]";
  if (value == null) return value;
  const valueType = typeof value;
  if (valueType === "string") {
    const text = value as string;
    return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}…[truncated]` : text;
  }
  if (valueType === "number" || valueType === "boolean") return value;
  if (valueType === "bigint") return String(value);
  if (valueType === "function" || valueType === "symbol") return `[${valueType}]`;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? sanitizeValue(value.stack, depth + 1) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

function sanitizeData(data?: Record<string, unknown>) {
  if (!data) return undefined;
  return sanitizeValue(data) as Record<string, unknown>;
}

function pruneEvents(now: number) {
  const minTime = now - DEBUG_LOG_MAX_AGE_MS;
  while (events.length > 0 && events[0].t < minTime) events.shift();
  if (events.length > DEBUG_LOG_MAX_EVENTS) events.splice(0, events.length - DEBUG_LOG_MAX_EVENTS);
}

export function getFlightRecorderSessionId() {
  return context.sessionId;
}

export function setFlightRecorderContext(next: Partial<Omit<FlightRecorderContext, "sessionId"> & { sessionId: string }>) {
  context = { ...context, ...next };
  debugLog("lifecycle", "recorder-context-updated", {
    role: context.role,
    playerId: context.playerId,
    callsign: context.callsign ?? null,
    buildLabel: context.buildLabel ?? null,
  });
}

export function debugLog(category: DebugCategory, event: string, data?: Record<string, unknown>, level: DebugSeverity = "info") {
  const now = Date.now();
  const entry: DebugLogEvent = {
    t: now,
    iso: new Date(now).toISOString(),
    sessionId: context.sessionId,
    playerId: context.playerId,
    callsign: context.callsign ?? null,
    role: context.role,
    level,
    category,
    event,
    data: sanitizeData(data),
  };
  events.push(entry);
  if (level === "warn" || level === "error") incidentCount += 1;
  pruneEvents(now);
}

export function debugWarn(category: DebugCategory, event: string, data?: Record<string, unknown>) {
  debugLog(category, event, data, "warn");
}

export function debugError(category: DebugCategory, event: string, data?: Record<string, unknown>) {
  debugLog(category, event, data, "error");
}

export function getRecentDebugEvents() {
  return events.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined }));
}

export function clearDebugLog() {
  events.length = 0;
  incidentCount = 0;
  debugLog("lifecycle", "recorder-cleared");
}

export function installFlightRecorderErrorCapture() {
  if (errorCaptureInstalled || typeof window === "undefined") return;
  errorCaptureInstalled = true;
  window.addEventListener("error", (event) => {
    debugError("error", "window-error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error instanceof Error ? event.error : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    debugError("error", "unhandled-rejection", {
      reason: event.reason instanceof Error ? event.reason : sanitizeValue(event.reason),
    });
  });
  debugLog("lifecycle", "recorder-error-capture-installed");
}

export function buildDebugBundle(extra?: Record<string, unknown>): DebugBundle {
  const recentEvents = getRecentDebugEvents();
  const warnCount = recentEvents.filter((entry) => entry.level === "warn").length;
  const errorCount = recentEvents.filter((entry) => entry.level === "error").length;
  const firstEventAt = recentEvents[0]?.iso;
  const lastEventAt = recentEvents[recentEvents.length - 1]?.iso;
  return {
    game: "Metatron Vector Foil",
    recorder: "Metatron Flight Recorder",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sessionId: context.sessionId,
    context: { ...context },
    client: {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "unknown",
      viewport: {
        width: typeof window !== "undefined" ? window.innerWidth : 0,
        height: typeof window !== "undefined" ? window.innerHeight : 0,
        devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      },
    },
    summary: {
      eventCount: recentEvents.length,
      warnCount,
      errorCount,
      incidentCount,
      firstEventAt,
      lastEventAt,
    },
    extra: sanitizeData(extra),
    recentEvents,
  };
}

export function exportDebugBundle(extra?: Record<string, unknown>) {
  if (typeof document === "undefined") return null;
  debugLog("lifecycle", "debug-export-requested", { extraKeys: extra ? Object.keys(extra) : [] });
  const bundle = buildDebugBundle(extra);
  const body = JSON.stringify(bundle, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const role = context.role;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `metatron-debug-${stamp}-${role}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
