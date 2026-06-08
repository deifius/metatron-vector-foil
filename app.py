from __future__ import annotations

import hashlib
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import secrets
import sqlite3
import threading
import time
import uuid
from functools import wraps
from typing import Any, Callable, TypeVar
from urllib.parse import urlencode, urlsplit

from flask import Flask, Response, abort, g, jsonify, redirect, render_template, request, session
from werkzeug.exceptions import HTTPException, InternalServerError
from werkzeug.middleware.proxy_fix import ProxyFix

from app_config import (
    ACCEPT_CLIENT_DEBUG_LOGS,
    CALLSIGN_RATE_LIMIT_SECONDS,
    CALLSIGN_RE,
    CLIENT_EVENT_RATE_LIMIT_SECONDS,
    CLIENT_EVENT_TYPES,
    CONTENT_SECURITY_POLICY,
    DEV_AUTH_ENABLED,
    DEV_AUTH_RATE_LIMIT_SECONDS,
    DEV_AUTH_RE,
    DB_PATH,
    ENABLE_HSTS,
    FLASK_SECRET_KEY,
    GOOGLE_ISSUERS,
    GOOGLE_OAUTH_ALLOWED_HD,
    GOOGLE_OAUTH_AUTH_ENDPOINT,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_ENABLED,
    GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_OAUTH_SCOPES,
    GOOGLE_OAUTH_STATE_TTL_SECONDS,
    GOOGLE_OAUTH_TOKEN_ENDPOINT,
    GOOGLE_OAUTH_TOKEN_TIMEOUT_SECONDS,
    IDENTITY_PEPPER,
    LEADERBOARD_DEFAULT_LIMIT,
    LEADERBOARD_MAX_LIMIT,
    LOG_BACKUPS,
    LOG_DICT_MAX_ITEMS,
    LOG_JSON,
    LOG_LEVEL,
    LOG_LIST_MAX_ITEMS,
    LOG_MAX_BYTES,
    LOG_MAX_DEPTH,
    LOG_PATH,
    LOG_PEPPER,
    LOG_STATIC_REQUESTS,
    LOG_STRING_MAX_CHARS,
    MAX_CONTENT_LENGTH_BYTES,
    MULTIPLAYER_INVITE_RATE_LIMIT_SECONDS,
    MULTIPLAYER_INVITE_TTL_SECONDS,
    MULTIPLAYER_ICE_SERVERS,
    MULTIPLAYER_MAX_PILOTS,
    MULTIPLAYER_MAX_SIGNAL_BYTES,
    MULTIPLAYER_ROOM_RATE_LIMIT_SECONDS,
    MULTIPLAYER_ROOM_TTL_SECONDS,
    MULTIPLAYER_SIGNAL_RATE_LIMIT_SECONDS,
    MULTIPLAYER_SIGNAL_TTL_SECONDS,
    OAUTH_LOGIN_RATE_LIMIT_SECONDS,
    PERMISSIONS_POLICY,
    REQUEST_ID_RE,
    SCORE_SUBMIT_RATE_LIMIT_SECONDS,
    SENSITIVE_LOG_KEYS,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
    VALID_CAUSES,
    VALID_LOG_SEVERITIES,
)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# A production deployment MUST set FLASK_SECRET_KEY in the service environment.
# The generated development key keeps local sessions working without committing a secret.
app.secret_key = FLASK_SECRET_KEY or secrets.token_urlsafe(48)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE=SESSION_COOKIE_SECURE,
    JSON_SORT_KEYS=False,
    MAX_CONTENT_LENGTH=MAX_CONTENT_LENGTH_BYTES,
)



class JsonFormatter(logging.Formatter):
    """Small structured formatter for production-friendly JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "event_type",
            "severity",
            "request_id",
            "method",
            "path",
            "status_code",
            "duration_ms",
            "player_id",
            "callsign",
            "ip_hash",
            "user_agent_hash",
            "details",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def setup_logging() -> None:
    level_name = LOG_LEVEL.upper()
    level = getattr(logging, level_name, logging.INFO)
    app.logger.setLevel(level)
    app.logger.handlers.clear()

    formatter: logging.Formatter
    if LOG_JSON:
        formatter = JsonFormatter()
    else:
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")

    log_path = LOG_PATH
    if log_path:
        from pathlib import Path
        path = Path(log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = RotatingFileHandler(
            path,
            maxBytes=LOG_MAX_BYTES,
            backupCount=LOG_BACKUPS,
            encoding="utf-8",
        )
    else:
        handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.setLevel(level)
    app.logger.addHandler(handler)
    app.logger.propagate = False


setup_logging()


# Multiplayer room/invite state is intentionally ephemeral in this pass. It is
# the central signaling/coordination layer, not the gameplay transport. Live
# gameplay should move over WebRTC DataChannels once the peers have carrier lock.
MULTIPLAYER_ROOM_VISIBILITIES = {"PUBLIC", "UNLISTED", "PRIVATE"}
MULTIPLAYER_CONFIG_POLICIES = {"HOST LOCKED", "PERSONAL SHIPS", "OPEN LAB"}
MULTIPLAYER_ROOM_STATUSES = {"LOBBY", "COUNTDOWN", "PLAYING", "DEBRIEF"}
MULTIPLAYER_INVITE_DECISIONS = {"accept", "decline"}
_multiplayer_lock = threading.Lock()
_multiplayer_rooms: dict[str, dict[str, Any]] = {}
_multiplayer_invites: dict[str, dict[str, Any]] = {}
_multiplayer_signals: list[dict[str, Any]] = []
_multiplayer_signal_seq = 0


def log_secret() -> bytes:
    configured = LOG_PEPPER or app.secret_key
    return str(configured).encode("utf-8")


def stable_hash(value: str | None, purpose: str) -> str | None:
    if not value:
        return None
    digest = hmac.new(log_secret(), f"{purpose}:{value}".encode("utf-8", "replace"), hashlib.sha256).hexdigest()
    return digest[:32]


def identity_secret() -> bytes:
    configured = IDENTITY_PEPPER or app.secret_key
    return str(configured).encode("utf-8")


def google_subject_identity_key(issuer: str, subject: str) -> str:
    """Return a non-reversible account key for a Google issuer+sub pair.

    Google's raw `sub` claim is stable and unique, but storing only a
    server-peppered HMAC reduces the blast radius of a database leak.
    Changing MVF_IDENTITY_PEPPER will intentionally orphan existing Google
    account mappings unless the database is migrated.
    """
    digest = hmac.new(identity_secret(), f"google:{issuer}:{subject}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"google:{digest}"


def google_redirect_uri() -> str:
    if GOOGLE_OAUTH_REDIRECT_URI:
        return GOOGLE_OAUTH_REDIRECT_URI
    return f"{request.host_url.rstrip('/')}/auth/google/callback"


def safe_next_path(raw: str | None) -> str:
    if not raw:
        return "/"
    raw = str(raw).strip()
    if not raw.startswith("/") or raw.startswith("//") or "\\" in raw:
        return "/"
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return "/"
    return raw or "/"


def redirect_with_auth_failure(reason: str) -> Response:
    log_event("auth.google_failed", "warning", details={"reason": reason}, persist=True)
    return redirect("/?auth=failed", code=303)


def request_id() -> str:
    incoming = request.headers.get("X-Request-ID", "")
    if REQUEST_ID_RE.fullmatch(incoming):
        return incoming
    return uuid.uuid4().hex


def sanitize_for_log(value: Any, depth: int = 0) -> Any:
    if depth > LOG_MAX_DEPTH:
        return "[max_depth]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.replace("\r", "\\r").replace("\n", "\\n")
        if len(cleaned) > LOG_STRING_MAX_CHARS:
            return cleaned[:LOG_STRING_MAX_CHARS] + "…"
        return cleaned
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (key, item) in enumerate(value.items()):
            if i >= LOG_DICT_MAX_ITEMS:
                out["_truncated"] = True
                break
            key_s = str(key)[:80]
            key_l = key_s.lower()
            if any(sensitive in key_l for sensitive in SENSITIVE_LOG_KEYS):
                out[key_s] = "[redacted]"
            else:
                out[key_s] = sanitize_for_log(item, depth + 1)
        return out
    if isinstance(value, (list, tuple, set)):
        return [sanitize_for_log(item, depth + 1) for item in list(value)[:LOG_LIST_MAX_ITEMS]]
    return sanitize_for_log(str(value), depth + 1)


def current_ip_hash() -> str | None:
    return stable_hash(request.remote_addr, "ip")


def current_user_agent_hash() -> str | None:
    return stable_hash(request.headers.get("User-Agent"), "ua")


def player_snapshot(player: sqlite3.Row | None = None) -> tuple[int | None, str | None]:
    row = player or current_player()
    if not row:
        return None, None
    return int(row["id"]), row["callsign"] if row["callsign"] else None


def persist_audit_event(
    event_type: str,
    severity: str,
    player_id: int | None,
    callsign: str | None,
    details: dict[str, Any] | None,
) -> None:
    try:
        get_db().execute(
            """
            INSERT INTO audit_events
              (event_type, severity, request_id, player_id, callsign_snapshot, ip_hash, user_agent_hash, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_type,
                severity,
                getattr(g, "request_id", None),
                player_id,
                callsign,
                current_ip_hash(),
                current_user_agent_hash(),
                json.dumps(sanitize_for_log(details or {}), separators=(",", ":"), sort_keys=True),
            ),
        )
        get_db().commit()
    except Exception:
        app.logger.exception("audit_event_persist_failed", extra={"event_type": "audit.persist_failed", "severity": "error"})


def log_event(
    event_type: str,
    severity: str = "info",
    *,
    player: sqlite3.Row | None = None,
    details: dict[str, Any] | None = None,
    persist: bool = False,
    status_code: int | None = None,
) -> None:
    severity = severity if severity in VALID_LOG_SEVERITIES else "info"
    level = getattr(logging, severity.upper(), logging.INFO)
    player_id, callsign = player_snapshot(player)
    safe_details = sanitize_for_log(details or {})
    extra = {
        "event_type": event_type,
        "severity": severity,
        "request_id": getattr(g, "request_id", None),
        "method": request.method if request else None,
        "path": request.path if request else None,
        "status_code": status_code,
        "player_id": player_id,
        "callsign": callsign,
        "ip_hash": current_ip_hash() if request else None,
        "user_agent_hash": current_user_agent_hash() if request else None,
        "details": safe_details,
    }
    app.logger.log(level, event_type, extra=extra)
    if persist:
        persist_audit_event(event_type, severity, player_id, callsign, safe_details if isinstance(safe_details, dict) else {"value": safe_details})


def score_integrity_flags(score: int, wave: int, survival: float, citations: int, spheres: int) -> list[str]:
    flags: list[str] = []
    if survival < 5 and score > 10_000:
        flags.append("high_score_low_survival")
    if survival > 0 and score / max(survival, 1.0) > 25_000:
        flags.append("high_score_rate")
    if wave > 1 and survival < (wave - 1) * 4:
        flags.append("wave_progression_fast")
    if citations > max(20, wave * 40):
        flags.append("citation_count_high_for_wave")
    if spheres > 13:
        flags.append("sphere_count_invalid")
    return flags
F = TypeVar("F", bound=Callable[..., Any])


def get_db() -> sqlite3.Connection:
    db = getattr(g, "_mvf_db", None)
    if db is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        g._mvf_db = db
    return db


@app.teardown_appcontext
def close_db(_exc: BaseException | None) -> None:
    db = getattr(g, "_mvf_db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          google_sub TEXT COLLATE BINARY UNIQUE,
          anonymous_id TEXT COLLATE BINARY UNIQUE,
          callsign TEXT COLLATE BINARY UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          callsign_snapshot TEXT COLLATE BINARY NOT NULL,
          score INTEGER NOT NULL CHECK (score >= 0),
          wave INTEGER NOT NULL CHECK (wave >= 1),
          survival_time_sec REAL NOT NULL CHECK (survival_time_sec >= 0),
          best_chain REAL NOT NULL DEFAULT 1.0,
          citations INTEGER NOT NULL DEFAULT 0,
          spheres_awakened INTEGER NOT NULL DEFAULT 0,
          cause_key TEXT NOT NULL DEFAULT 'unknown',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_scores_rank
          ON scores(score DESC, wave DESC, survival_time_sec DESC, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_player
          ON scores(player_id, score DESC, wave DESC, survival_time_sec DESC);

        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
          request_id TEXT,
          player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
          callsign_snapshot TEXT COLLATE BINARY,
          ip_hash TEXT,
          user_agent_hash TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_events_created
          ON audit_events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_type
          ON audit_events(event_type, severity, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_player
          ON audit_events(player_id, created_at DESC);
        """
    )
    db.commit()


@app.before_request
def before_request() -> None:
    g.request_id = request_id()
    g.request_started_at = time.perf_counter()
    init_db()
    ensure_session_tokens()


@app.after_request
def add_security_headers(resp: Response) -> Response:
    # React uses inline style attributes heavily, so style-src needs unsafe-inline until the UI is refactored.
    resp.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
    resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if ENABLE_HSTS:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers.setdefault("X-Request-ID", getattr(g, "request_id", ""))
    emit_access_log(resp)
    return resp


def emit_access_log(resp: Response) -> None:
    duration_ms = round((time.perf_counter() - float(getattr(g, "request_started_at", time.perf_counter()))) * 1000, 2)
    is_static = request.path.startswith("/static/")
    if is_static and resp.status_code < 400 and not LOG_STATIC_REQUESTS:
        return
    severity = "warning" if resp.status_code >= 400 else "info"
    if resp.status_code >= 500:
        severity = "error"
    player_id, callsign = player_snapshot()
    app.logger.log(
        getattr(logging, severity.upper(), logging.INFO),
        "http.request",
        extra={
            "event_type": "http.request",
            "severity": severity,
            "request_id": getattr(g, "request_id", None),
            "method": request.method,
            "path": request.path,
            "status_code": resp.status_code,
            "duration_ms": duration_ms,
            "player_id": player_id,
            "callsign": callsign,
            "ip_hash": current_ip_hash(),
            "user_agent_hash": current_user_agent_hash(),
            "details": {"content_length": request.content_length},
        },
    )


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(409)
@app.errorhandler(413)
@app.errorhandler(429)
def api_error(err: Any):
    code = int(getattr(err, "code", 500))
    desc = str(getattr(err, "description", "request_failed"))
    if request.path.startswith("/api/"):
        log_event(
            "api.request_rejected",
            "warning" if code < 500 else "error",
            details={"error": desc, "status_code": code},
            persist=code in {400, 403, 409, 413, 429},
            status_code=code,
        )
        return jsonify({"ok": False, "error": desc, "requestId": getattr(g, "request_id", None)}), code
    return err


@app.errorhandler(Exception)
def unhandled_error(err: Exception):
    if isinstance(err, HTTPException):
        return err
    app.logger.exception(
        "server.unhandled_exception",
        extra={
            "event_type": "server.unhandled_exception",
            "severity": "error",
            "request_id": getattr(g, "request_id", None),
            "method": request.method if request else None,
            "path": request.path if request else None,
            "status_code": 500,
            "player_id": player_snapshot()[0] if request else None,
            "callsign": player_snapshot()[1] if request else None,
            "ip_hash": current_ip_hash() if request else None,
            "user_agent_hash": current_user_agent_hash() if request else None,
            "details": {},
        },
    )
    try:
        persist_audit_event("server.unhandled_exception", "error", *player_snapshot(), {"path": request.path})
    except Exception:
        pass
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "server_error", "requestId": getattr(g, "request_id", None)}), 500
    return InternalServerError()


def ensure_session_tokens() -> None:
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    if "anonymous_id" not in session:
        session["anonymous_id"] = secrets.token_urlsafe(24)
    session.permanent = False


def json_body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, "expected_json_object")
    return data


def same_origin_ok() -> bool:
    origin = request.headers.get("Origin")
    if not origin:
        return True
    host_url = request.host_url.rstrip("/")
    parsed_origin = urlsplit(origin)
    parsed_host = urlsplit(host_url)
    return (parsed_origin.scheme, parsed_origin.netloc) == (parsed_host.scheme, parsed_host.netloc)


def require_csrf(fn: F) -> F:
    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        if not same_origin_ok():
            abort(403, "bad_origin")
        sent = request.headers.get("X-CSRF-Token")
        if not sent:
            body = request.get_json(silent=True) or {}
            sent = body.get("csrfToken") if isinstance(body, dict) else None
        if not sent or not secrets.compare_digest(str(sent), str(session.get("csrf_token", ""))):
            abort(403, "bad_csrf_token")
        return fn(*args, **kwargs)

    return wrapper  # type: ignore[return-value]


def session_rate_limit(bucket: str, seconds: float) -> None:
    now = time.time()
    key = f"rate:{bucket}"
    last = float(session.get(key, 0.0))
    if now - last < seconds:
        abort(429, "rate_limited")
    session[key] = now
    session.modified = True


def auth_provider() -> str:
    google_sub = str(session.get("google_sub") or "")
    if google_sub.startswith("dev:"):
        return "developer"
    if google_sub:
        return "google"
    return "none"


def current_player() -> sqlite3.Row | None:
    """Return the authenticated player for this session, never an anonymous callsign claimant."""
    google_sub = session.get("google_sub")
    if not google_sub:
        return None
    return get_db().execute("SELECT * FROM players WHERE google_sub = ?", (google_sub,)).fetchone()


def authenticated_player(create: bool = False) -> sqlite3.Row | None:
    google_sub = session.get("google_sub")
    if not google_sub:
        return None
    row = current_player()
    if row or not create:
        return row

    # Smoothly migrate old development/browser-session claims into the authenticated model.
    # This avoids orphaning callsigns that were claimed before callsigns became login-bound.
    anon = session.get("anonymous_id")
    if anon:
        legacy = get_db().execute(
            "SELECT * FROM players WHERE anonymous_id = ? AND google_sub IS NULL",
            (anon,),
        ).fetchone()
        if legacy:
            get_db().execute(
                "UPDATE players SET google_sub = ?, updated_at = datetime('now') WHERE id = ?",
                (google_sub, legacy["id"]),
            )
            get_db().commit()
            return current_player()

    anon_for_insert = anon
    if anon and get_db().execute("SELECT id FROM players WHERE anonymous_id = ?", (anon,)).fetchone():
        anon_for_insert = None
    get_db().execute(
        "INSERT INTO players (google_sub, anonymous_id) VALUES (?, ?)",
        (google_sub, anon_for_insert),
    )
    get_db().commit()
    return current_player()


def public_player_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    return {
        "authenticated": bool(session.get("google_sub")),
        "authProvider": auth_provider(),
        "callsign": row["callsign"] if row and row["callsign"] else None,
        "canChooseCallsign": bool(session.get("google_sub")) and bool(row is None or not row["callsign"]),
    }


def require_callsign_player() -> sqlite3.Row:
    player = current_player()
    if not session.get("google_sub"):
        abort(403, "login_required_before_multiplayer")
    if not player or not player["callsign"]:
        abort(403, "set_callsign_before_multiplayer")
    return player


def normalize_room_visibility(raw: Any) -> str:
    value = str(raw or "UNLISTED").strip().upper().replace("_", " ")
    if value not in MULTIPLAYER_ROOM_VISIBILITIES:
        abort(400, "invalid_room_visibility")
    return value


def normalize_config_policy(raw: Any) -> str:
    value = str(raw or "HOST LOCKED").strip().upper().replace("_", " ")
    if value not in MULTIPLAYER_CONFIG_POLICIES:
        abort(400, "invalid_config_policy")
    return value


def normalize_room_status(raw: Any) -> str:
    value = str(raw or "LOBBY").strip().upper().replace("_", " ")
    if value not in MULTIPLAYER_ROOM_STATUSES:
        abort(400, "invalid_room_status")
    return value


def multiplayer_room_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(4))


def multiplayer_public_room(room: dict[str, Any]) -> dict[str, Any]:
    return {
        "roomId": room["roomId"],
        "roomCode": room["roomCode"],
        "hostCallsign": room["hostCallsign"],
        "visibility": room["visibility"],
        "configPolicy": room["configPolicy"],
        "status": room["status"],
        "route": room.get("route", "SIGNAL SERVER"),
        "lastSignal": room.get("lastSignal", "DEFENSE CHANNEL OPEN"),
        "createdAt": room["createdAt"],
        "updatedAt": room["updatedAt"],
        "pilots": list(room.get("pilots", []))[:MULTIPLAYER_MAX_PILOTS],
    }


def multiplayer_public_invite(invite: dict[str, Any]) -> dict[str, Any]:
    return {
        "inviteId": invite["inviteId"],
        "roomId": invite["roomId"],
        "roomCode": invite["roomCode"],
        "fromCallsign": invite["fromCallsign"],
        "toCallsign": invite["toCallsign"],
        "status": invite["status"],
        "createdAt": invite["createdAt"],
        "expiresAt": invite["expiresAt"],
    }


def cleanup_multiplayer_state(now: float | None = None) -> None:
    now = time.time() if now is None else now
    expired_rooms = [
        room_id
        for room_id, room in _multiplayer_rooms.items()
        if now - float(room.get("updatedAtEpoch", room.get("createdAtEpoch", now))) > MULTIPLAYER_ROOM_TTL_SECONDS
    ]
    for room_id in expired_rooms:
        _multiplayer_rooms.pop(room_id, None)
    expired_invites = [
        invite_id
        for invite_id, invite in _multiplayer_invites.items()
        if float(invite.get("expiresAtEpoch", 0.0)) <= now
        or (invite.get("status") != "PENDING" and now - float(invite.get("updatedAtEpoch", now)) > 60)
    ]
    for invite_id in expired_invites:
        _multiplayer_invites.pop(invite_id, None)

    live_room_ids = set(_multiplayer_rooms.keys())
    _multiplayer_signals[:] = [
        signal for signal in _multiplayer_signals
        if signal.get("roomId") in live_room_ids
        and now - float(signal.get("createdAtEpoch", now)) <= MULTIPLAYER_SIGNAL_TTL_SECONDS
    ]


def find_room_by_code(room_code: str) -> dict[str, Any] | None:
    for room in _multiplayer_rooms.values():
        if room.get("roomCode") == room_code:
            return room
    return None



def room_callsigns(room: dict[str, Any]) -> set[str]:
    return {str(pilot.get("callsign")) for pilot in room.get("pilots", []) if pilot.get("callsign") and pilot.get("role") != "SLOT"}


def require_room_member(room_id: str, player: sqlite3.Row) -> dict[str, Any]:
    room = _multiplayer_rooms.get(room_id)
    if not room:
        abort(404, "room_not_found")
    if player["callsign"] not in room_callsigns(room):
        abort(403, "room_membership_required")
    return room


def sanitize_signal_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        abort(400, "invalid_signal_payload")
    try:
        encoded = json.dumps(raw, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError):
        abort(400, "invalid_signal_payload")
    if len(encoded.encode("utf-8")) > MULTIPLAYER_MAX_SIGNAL_BYTES:
        abort(413, "signal_payload_too_large")
    return raw


def multiplayer_public_signal(signal: dict[str, Any]) -> dict[str, Any]:
    return {
        "seq": signal["seq"],
        "roomId": signal["roomId"],
        "fromCallsign": signal["fromCallsign"],
        "toCallsign": signal["toCallsign"],
        "signalType": signal["signalType"],
        "payload": signal["payload"],
        "createdAt": signal["createdAt"],
    }

def add_or_update_room_pilot(room: dict[str, Any], callsign: str, role: str, status: str) -> None:
    pilots = list(room.get("pilots", []))
    for pilot in pilots:
        if pilot.get("callsign") == callsign:
            pilot["role"] = role
            pilot["status"] = status
            pilot["signalAgeMs"] = 0
            break
    else:
        if len([pilot for pilot in pilots if pilot.get("role") != "SLOT"]) >= MULTIPLAYER_MAX_PILOTS:
            abort(409, "room_full")
        pilots.append({"callsign": callsign, "role": role, "status": status, "signalAgeMs": 0})
    room["pilots"] = pilots[:MULTIPLAYER_MAX_PILOTS]


def parse_int(data: dict[str, Any], name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(data.get(name, default))
    except (TypeError, ValueError):
        abort(400, f"invalid_{name}")
    if value < low or value > high:
        abort(400, f"invalid_{name}")
    return value


def parse_float(data: dict[str, Any], name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(data.get(name, default))
    except (TypeError, ValueError):
        abort(400, f"invalid_{name}")
    if value < low or value > high:
        abort(400, f"invalid_{name}")
    return value


@app.get("/auth/google/start")
def google_oauth_start():
    if not GOOGLE_OAUTH_ENABLED:
        abort(404, "google_oauth_not_configured")
    if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
        log_event("auth.google_misconfigured", "error", details={"missing": "client_id_or_secret"}, persist=True)
        abort(500, "google_oauth_misconfigured")

    session_rate_limit("oauth_login", OAUTH_LOGIN_RATE_LIMIT_SECONDS)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    session["oauth_google_state"] = state
    session["oauth_google_nonce"] = nonce
    session["oauth_google_started_at"] = time.time()
    session["oauth_google_next"] = safe_next_path(request.args.get("next"))
    session.modified = True

    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": google_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(GOOGLE_OAUTH_SCOPES),
        "state": state,
        "nonce": nonce,
        "access_type": "online",
        "include_granted_scopes": "false",
    }
    return redirect(f"{GOOGLE_OAUTH_AUTH_ENDPOINT}?{urlencode(params)}", code=302)


@app.get("/auth/google/callback")
def google_oauth_callback():
    if not GOOGLE_OAUTH_ENABLED:
        abort(404, "google_oauth_not_configured")

    next_path = safe_next_path(session.get("oauth_google_next"))
    expected_state = str(session.pop("oauth_google_state", ""))
    expected_nonce = str(session.pop("oauth_google_nonce", ""))
    started_at = float(session.pop("oauth_google_started_at", 0.0) or 0.0)
    session.pop("oauth_google_next", None)
    session.modified = True

    if request.args.get("error"):
        log_event(
            "auth.google_denied",
            "warning",
            details={"google_error": str(request.args.get("error", "unknown"))[:80]},
            persist=True,
        )
        return redirect("/?auth=denied", code=303)

    sent_state = str(request.args.get("state", ""))
    if not expected_state or not sent_state or not secrets.compare_digest(expected_state, sent_state):
        return redirect_with_auth_failure("state_mismatch")
    if not expected_nonce:
        return redirect_with_auth_failure("missing_nonce")
    if time.time() - started_at > GOOGLE_OAUTH_STATE_TTL_SECONDS:
        return redirect_with_auth_failure("state_expired")

    code = str(request.args.get("code", ""))
    if not code:
        return redirect_with_auth_failure("missing_code")

    try:
        import requests as http_requests
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except Exception:
        log_event("auth.google_dependency_missing", "error", persist=True)
        return redirect_with_auth_failure("oauth_dependency_missing")

    try:
        token_resp = http_requests.post(
            GOOGLE_OAUTH_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "redirect_uri": google_redirect_uri(),
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
            timeout=GOOGLE_OAUTH_TOKEN_TIMEOUT_SECONDS,
        )
    except Exception:
        log_event("auth.google_token_exchange_exception", "error", persist=True)
        return redirect_with_auth_failure("token_exchange_exception")

    if token_resp.status_code != 200:
        log_event(
            "auth.google_token_exchange_failed",
            "warning",
            details={"status_code": token_resp.status_code},
            persist=True,
        )
        return redirect_with_auth_failure("token_exchange_failed")

    token_payload = token_resp.json() if token_resp.content else {}
    id_token_jwt = token_payload.get("id_token") if isinstance(token_payload, dict) else None
    if not isinstance(id_token_jwt, str) or not id_token_jwt:
        return redirect_with_auth_failure("missing_id_token")

    try:
        claims = google_id_token.verify_oauth2_token(
            id_token_jwt,
            google_requests.Request(),
            GOOGLE_OAUTH_CLIENT_ID,
        )
    except Exception:
        log_event("auth.google_id_token_invalid", "warning", persist=True)
        return redirect_with_auth_failure("invalid_id_token")

    issuer = str(claims.get("iss", ""))
    subject = str(claims.get("sub", ""))
    nonce = str(claims.get("nonce", ""))
    hosted_domain = str(claims.get("hd", ""))

    if issuer not in GOOGLE_ISSUERS:
        return redirect_with_auth_failure("bad_issuer")
    if not subject:
        return redirect_with_auth_failure("missing_subject")
    if not nonce or not secrets.compare_digest(expected_nonce, nonce):
        return redirect_with_auth_failure("nonce_mismatch")
    if GOOGLE_OAUTH_ALLOWED_HD and hosted_domain != GOOGLE_OAUTH_ALLOWED_HD:
        log_event("auth.google_hd_rejected", "warning", details={"has_hd": bool(hosted_domain)}, persist=True)
        return redirect("/?auth=domain_denied", code=303)

    old_anon = session.get("anonymous_id")
    identity_key = google_subject_identity_key(issuer, subject)

    session.clear()
    session["csrf_token"] = secrets.token_urlsafe(32)
    session["anonymous_id"] = old_anon or secrets.token_urlsafe(24)
    session["google_sub"] = identity_key
    session["auth_provider"] = "google"
    session.modified = True

    player = authenticated_player(create=True)
    log_event(
        "auth.google_login",
        "info",
        player=player,
        details={"hosted_domain_present": bool(hosted_domain), "allowed_domain_required": bool(GOOGLE_OAUTH_ALLOWED_HD)},
        persist=True,
    )
    return redirect(next_path, code=303)


@app.post("/api/client-events")
@require_csrf
def client_events():
    session_rate_limit("client_events", CLIENT_EVENT_RATE_LIMIT_SECONDS)
    data = json_body()
    event_type = str(data.get("eventType", "client.unknown"))
    if event_type not in CLIENT_EVENT_TYPES:
        event_type = "client.unknown"
    severity = str(data.get("severity", "info")).lower()
    if severity not in VALID_LOG_SEVERITIES:
        severity = "info"
    if severity == "debug" and not ACCEPT_CLIENT_DEBUG_LOGS:
        severity = "info"
    details = data.get("details") if isinstance(data.get("details"), dict) else {}
    log_event(
        event_type,
        severity,
        details=details,
        persist=severity in {"warning", "error", "critical"} or event_type in {"client.render_error", "client.score_submission_error"},
    )
    return jsonify({"ok": True})


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/security/status")
def security_status():
    row = current_player()
    return jsonify(
        {
            "ok": True,
            "csrfToken": session["csrf_token"],
            "player": public_player_payload(row),
            "devAuthEnabled": DEV_AUTH_ENABLED,
            "googleAuthEnabled": GOOGLE_OAUTH_ENABLED,
            "googleLoginUrl": "/auth/google/start" if GOOGLE_OAUTH_ENABLED else None,
            "multiplayerIceServers": MULTIPLAYER_ICE_SERVERS,
            "identityPolicy": {
                "publicIdentifier": "3-character case-sensitive callsign",
                "callsignClaiming": "requires authenticated account and no existing callsign",
                "publicFields": ["callsign", "score", "wave", "survivalTimeSec", "createdAt"],
                "googleDataStored": ["server-peppered HMAC of issuer plus sub, when Google OAuth is enabled"],
                "googleDataNotStored": ["raw sub", "email", "name", "avatar", "access_token", "refresh_token", "id_token"],
            },
        }
    )


@app.post("/api/dev-login")
@require_csrf
def dev_login():
    if not DEV_AUTH_ENABLED:
        abort(404, "not_found")
    session_rate_limit("dev_auth", DEV_AUTH_RATE_LIMIT_SECONDS)
    data = json_body()
    handle = str(data.get("handle", "dev"))
    if not DEV_AUTH_RE.fullmatch(handle):
        abort(400, "invalid_dev_handle")
    session["google_sub"] = f"dev:{handle}"
    session.modified = True
    player = authenticated_player(create=True)
    log_event("auth.dev_login", "warning", player=player, details={"dev_handle": handle}, persist=True)
    return jsonify({"ok": True, "player": public_player_payload(player)})


@app.post("/api/player/logout")
@require_csrf
def logout_player():
    player = current_player()
    log_event("auth.logout", "info", player=player, persist=True)
    csrf_token = session.get("csrf_token")
    anonymous_id = secrets.token_urlsafe(24)
    session.clear()
    session["csrf_token"] = csrf_token or secrets.token_urlsafe(32)
    session["anonymous_id"] = anonymous_id
    session.modified = True
    return jsonify({"ok": True, "player": public_player_payload(None), "csrfToken": session["csrf_token"]})


@app.post("/api/player/callsign")
@require_csrf
def set_callsign():
    session_rate_limit("callsign", CALLSIGN_RATE_LIMIT_SECONDS)
    if not session.get("google_sub"):
        log_event("player.callsign_without_login", "warning", persist=True)
        abort(403, "login_required_before_callsign")

    data = json_body()
    callsign = str(data.get("callsign", ""))
    if not CALLSIGN_RE.fullmatch(callsign):
        abort(400, "callsign_must_be_exactly_3_case_sensitive_ascii_letters_or_digits")

    db = get_db()
    me = authenticated_player(create=True)
    if not me:
        abort(403, "login_required_before_callsign")

    if me["callsign"]:
        if me["callsign"] == callsign:
            return jsonify({"ok": True, "unchanged": True, "player": public_player_payload(me)})
        log_event(
            "player.callsign_change_blocked",
            "warning",
            player=me,
            details={"requested_callsign": callsign},
            persist=True,
        )
        abort(409, "callsign_already_assigned")

    existing = db.execute("SELECT id FROM players WHERE callsign = ? COLLATE BINARY", (callsign,)).fetchone()
    if existing:
        log_event("player.callsign_taken", "warning", player=me, details={"requested_callsign": callsign}, persist=True)
        abort(409, "callsign_taken")

    db.execute("UPDATE players SET callsign = ?, updated_at = datetime('now') WHERE id = ?", (callsign, me["id"]))
    db.commit()
    updated_player = current_player()
    log_event("player.callsign_set", "info", player=updated_player, details={"callsign": callsign}, persist=True)
    return jsonify({"ok": True, "player": public_player_payload(updated_player)})


@app.post("/api/multiplayer/rooms")
@require_csrf
def multiplayer_create_room():
    session_rate_limit("multiplayer_room", MULTIPLAYER_ROOM_RATE_LIMIT_SECONDS)
    player = require_callsign_player()
    data = json_body()
    visibility = normalize_room_visibility(data.get("visibility", "UNLISTED"))
    config_policy = normalize_config_policy(data.get("configPolicy", "HOST LOCKED"))
    now = time.time()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    room_id = secrets.token_urlsafe(10)
    with _multiplayer_lock:
        cleanup_multiplayer_state(now)
        room_code = multiplayer_room_code()
        while find_room_by_code(room_code):
            room_code = multiplayer_room_code()
        room = {
            "roomId": room_id,
            "roomCode": room_code,
            "hostCallsign": player["callsign"],
            "visibility": visibility,
            "configPolicy": config_policy,
            "status": "LOBBY",
            "route": "SIGNAL SERVER",
            "lastSignal": "DEFENSE CHANNEL OPEN // SIGNAL SERVER READY",
            "createdAt": stamp,
            "updatedAt": stamp,
            "createdAtEpoch": now,
            "updatedAtEpoch": now,
            "pilots": [
                {"callsign": player["callsign"], "role": "HOST", "status": "HOST LOCKED", "signalAgeMs": 0},
            ],
        }
        _multiplayer_rooms[room_id] = room
        public_room = multiplayer_public_room(room)
    log_event(
        "multiplayer.room_created",
        "info",
        player=player,
        details={"room_id": room_id, "visibility": visibility, "config_policy": config_policy},
        persist=True,
    )
    return jsonify({"ok": True, "room": public_room})


@app.get("/api/multiplayer/rooms/<room_id>")
def multiplayer_get_room(room_id: str):
    with _multiplayer_lock:
        cleanup_multiplayer_state()
        room = _multiplayer_rooms.get(room_id)
        if not room:
            abort(404, "room_not_found")
        return jsonify({"ok": True, "room": multiplayer_public_room(room)})


@app.post("/api/multiplayer/rooms/<room_id>/close")
@require_csrf
def multiplayer_close_room(room_id: str):
    player = require_callsign_player()
    with _multiplayer_lock:
        cleanup_multiplayer_state()
        room = _multiplayer_rooms.get(room_id)
        if not room:
            abort(404, "room_not_found")
        if room.get("hostCallsign") != player["callsign"]:
            abort(403, "host_required_to_close_room")
        _multiplayer_rooms.pop(room_id, None)
    log_event("multiplayer.room_closed", "info", player=player, details={"room_id": room_id}, persist=True)
    return jsonify({"ok": True})


@app.post("/api/multiplayer/rooms/<room_id>/status")
@require_csrf
def multiplayer_room_status(room_id: str):
    player = require_callsign_player()
    data = json_body()
    status = normalize_room_status(data.get("status", "LOBBY"))
    now = time.time()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    with _multiplayer_lock:
        cleanup_multiplayer_state(now)
        room = _multiplayer_rooms.get(room_id)
        if not room:
            abort(404, "room_not_found")
        if room.get("hostCallsign") != player["callsign"]:
            abort(403, "host_required_to_set_room_status")
        room["status"] = status
        room["lastSignal"] = f"HOST SCOPE {status} // {player['callsign']}"
        room["updatedAt"] = stamp
        room["updatedAtEpoch"] = now
        public_room = multiplayer_public_room(room)
    log_event("multiplayer.room_status", "info", player=player, details={"room_id": room_id, "status": status}, persist=False)
    return jsonify({"ok": True, "room": public_room})


@app.post("/api/multiplayer/rooms/<room_id>/invite")
@require_csrf
def multiplayer_invite(room_id: str):
    session_rate_limit("multiplayer_invite", MULTIPLAYER_INVITE_RATE_LIMIT_SECONDS)
    player = require_callsign_player()
    data = json_body()
    callsign = str(data.get("callsign", ""))
    if not CALLSIGN_RE.fullmatch(callsign):
        abort(400, "invalid_invite_callsign")
    if callsign == player["callsign"]:
        abort(400, "cannot_invite_self")
    target = get_db().execute("SELECT id, callsign FROM players WHERE callsign = ? COLLATE BINARY", (callsign,)).fetchone()
    if not target:
        abort(404, "callsign_not_found")

    now = time.time()
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    expires_at_epoch = now + MULTIPLAYER_INVITE_TTL_SECONDS
    expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at_epoch))
    invite_id = secrets.token_urlsafe(10)
    with _multiplayer_lock:
        cleanup_multiplayer_state(now)
        room = _multiplayer_rooms.get(room_id)
        if not room:
            abort(404, "room_not_found")
        if room.get("hostCallsign") != player["callsign"]:
            abort(403, "host_required_to_invite")
        add_or_update_room_pilot(room, callsign, "ALLY", "VECTOR SENT")
        room["lastSignal"] = f"CALLSIGN VECTOR SENT // {callsign}"
        room["updatedAt"] = created_at
        room["updatedAtEpoch"] = now
        invite = {
            "inviteId": invite_id,
            "roomId": room_id,
            "roomCode": room["roomCode"],
            "fromCallsign": player["callsign"],
            "toCallsign": callsign,
            "status": "PENDING",
            "createdAt": created_at,
            "updatedAtEpoch": now,
            "expiresAt": expires_at,
            "expiresAtEpoch": expires_at_epoch,
        }
        _multiplayer_invites[invite_id] = invite
        public_room = multiplayer_public_room(room)
        public_invite = multiplayer_public_invite(invite)
    log_event("multiplayer.invite_sent", "info", player=player, details={"room_id": room_id, "to_callsign": callsign}, persist=True)
    return jsonify({"ok": True, "room": public_room, "invite": public_invite})


@app.get("/api/multiplayer/invites")
def multiplayer_invites():
    player = current_player()
    if not player or not player["callsign"]:
        return jsonify({"ok": True, "invites": []})
    with _multiplayer_lock:
        cleanup_multiplayer_state()
        invites = [
            multiplayer_public_invite(invite)
            for invite in _multiplayer_invites.values()
            if invite.get("toCallsign") == player["callsign"] and invite.get("status") == "PENDING"
        ]
    invites.sort(key=lambda item: item["createdAt"], reverse=True)
    return jsonify({"ok": True, "invites": invites[:10]})


@app.post("/api/multiplayer/invites/<invite_id>/respond")
@require_csrf
def multiplayer_invite_respond(invite_id: str):
    player = require_callsign_player()
    data = json_body()
    decision = str(data.get("decision", "")).strip().lower()
    if decision not in MULTIPLAYER_INVITE_DECISIONS:
        abort(400, "invalid_invite_decision")
    now = time.time()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    with _multiplayer_lock:
        cleanup_multiplayer_state(now)
        invite = _multiplayer_invites.get(invite_id)
        if not invite:
            abort(404, "invite_not_found")
        if invite.get("toCallsign") != player["callsign"]:
            abort(403, "invite_not_for_this_callsign")
        if invite.get("status") != "PENDING":
            abort(409, "invite_already_resolved")
        invite["status"] = "ACCEPTED" if decision == "accept" else "DECLINED"
        invite["updatedAtEpoch"] = now
        room = _multiplayer_rooms.get(invite["roomId"])
        if decision == "accept":
            if not room:
                abort(404, "room_not_found")
            add_or_update_room_pilot(room, player["callsign"], "ALLY", "SIGNAL ACQUIRED")
            room["lastSignal"] = f"{player['callsign']} SIGNAL ACQUIRED // P2P CARRIER NEXT"
            room["updatedAt"] = stamp
            room["updatedAtEpoch"] = now
            public_room = multiplayer_public_room(room)
        else:
            if room:
                add_or_update_room_pilot(room, player["callsign"], "ALLY", "TRACE DECLINED")
                room["lastSignal"] = f"{player['callsign']} TRACE DECLINED"
                room["updatedAt"] = stamp
                room["updatedAtEpoch"] = now
            public_room = multiplayer_public_room(room) if room else None
        public_invite = multiplayer_public_invite(invite)
    log_event(
        "multiplayer.invite_responded",
        "info",
        player=player,
        details={"invite_id": invite_id, "decision": decision},
        persist=True,
    )
    return jsonify({"ok": True, "invite": public_invite, "room": public_room})


@app.post("/api/multiplayer/signal")
@require_csrf
def multiplayer_signal_post():
    # Identity-authorized WebRTC signaling mailbox. This endpoint carries only
    # offer/answer/ICE/heartbeat envelopes; live gameplay belongs on the P2P
    # DataChannel after PHOSPHOR LOCK. Payloads are size-limited and room-bound.
    global _multiplayer_signal_seq
    session_rate_limit("multiplayer_signal", MULTIPLAYER_SIGNAL_RATE_LIMIT_SECONDS)
    player = require_callsign_player()
    data = json_body()
    room_id = str(data.get("roomId", ""))
    signal_type = str(data.get("signalType", "")).strip().lower()
    to_callsign = str(data.get("toCallsign", ""))
    if signal_type not in {"offer", "answer", "ice", "heartbeat"}:
        abort(400, "invalid_signal_type")
    if not CALLSIGN_RE.fullmatch(to_callsign):
        abort(400, "invalid_signal_target")
    if to_callsign == player["callsign"]:
        abort(400, "cannot_signal_self")
    payload = sanitize_signal_payload(data.get("payload"))

    now = time.time()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    with _multiplayer_lock:
        cleanup_multiplayer_state(now)
        room = require_room_member(room_id, player)
        if to_callsign not in room_callsigns(room):
            abort(403, "signal_target_not_in_room")
        _multiplayer_signal_seq += 1
        signal = {
            "seq": _multiplayer_signal_seq,
            "roomId": room_id,
            "fromCallsign": player["callsign"],
            "toCallsign": to_callsign,
            "signalType": signal_type,
            "payload": payload,
            "createdAt": stamp,
            "createdAtEpoch": now,
        }
        _multiplayer_signals.append(signal)
        room["lastSignal"] = f"{player['callsign']} {signal_type.upper()} TRACE → {to_callsign}"
        room["updatedAt"] = stamp
        room["updatedAtEpoch"] = now
        public_signal = multiplayer_public_signal(signal)
    log_event(
        "multiplayer.signal_posted",
        "info",
        player=player,
        details={"room_id": room_id, "to_callsign": to_callsign, "signal_type": signal_type},
        persist=False,
    )
    return jsonify({"ok": True, "signal": public_signal})


@app.get("/api/multiplayer/signal")
def multiplayer_signal_get():
    player = require_callsign_player()
    room_id = str(request.args.get("roomId", ""))
    try:
        since = int(request.args.get("since", "0"))
    except ValueError:
        abort(400, "invalid_signal_since")
    if since < 0:
        abort(400, "invalid_signal_since")
    with _multiplayer_lock:
        cleanup_multiplayer_state()
        room = require_room_member(room_id, player)
        inbox = [
            multiplayer_public_signal(signal)
            for signal in _multiplayer_signals
            if signal.get("roomId") == room_id
            and signal.get("toCallsign") == player["callsign"]
            and int(signal.get("seq", 0)) > since
        ]
        latest_seq = max([since, *[int(signal.get("seq", since)) for signal in _multiplayer_signals if signal.get("roomId") == room_id]], default=since)
        room["updatedAtEpoch"] = time.time()
    return jsonify({"ok": True, "signals": inbox[-50:], "latestSeq": latest_seq})


@app.get("/api/leaderboard")
def leaderboard():
    limit = parse_int(request.args, "limit", LEADERBOARD_DEFAULT_LIMIT, 1, LEADERBOARD_MAX_LIMIT)  # type: ignore[arg-type]
    rows = get_db().execute(
        """
        SELECT callsign, score, wave, survival_time_sec, created_at
        FROM (
          SELECT
            COALESCE(p.callsign, s.callsign_snapshot) AS callsign,
            s.score,
            s.wave,
            s.survival_time_sec,
            s.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY s.player_id
              ORDER BY s.score DESC, s.wave DESC, s.survival_time_sec DESC, s.created_at ASC
            ) AS rn
          FROM scores s
          JOIN players p ON p.id = s.player_id
          WHERE p.callsign IS NOT NULL
        ) ranked
        WHERE rn = 1
        ORDER BY score DESC, wave DESC, survival_time_sec DESC, created_at ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return jsonify(
        {
            "ok": True,
            "entries": [
                {
                    "rank": i + 1,
                    "callsign": row["callsign"],
                    "score": int(row["score"]),
                    "wave": int(row["wave"]),
                    "survivalTimeSec": float(row["survival_time_sec"]),
                    "createdAt": row["created_at"],
                }
                for i, row in enumerate(rows)
            ],
        }
    )


@app.post("/api/scores")
@require_csrf
def submit_score():
    session_rate_limit("score", SCORE_SUBMIT_RATE_LIMIT_SECONDS)
    player = current_player()
    if not session.get("google_sub"):
        log_event("score.submit_without_login", "warning", persist=True)
        abort(403, "login_required_before_score")
    if not player or not player["callsign"]:
        log_event("score.submit_without_callsign", "warning", player=player, persist=True)
        abort(403, "set_callsign_before_submitting_score")

    data = json_body()
    score = parse_int(data, "score", 0, 0, 50_000_000)
    wave = parse_int(data, "wave", 1, 1, 999)
    survival = parse_float(data, "survivalTimeSec", 0.0, 0.0, 24 * 60 * 60)
    best_chain = parse_float(data, "bestChain", 1.0, 0.0, 1000.0)
    citations = parse_int(data, "citations", 0, 0, 10_000)
    spheres = parse_int(data, "spheresAwakened", 0, 0, 13)
    cause = str(data.get("causeKey", "unknown"))
    if cause not in VALID_CAUSES:
        log_event("score.invalid_cause", "warning", player=player, details={"cause_key": cause}, persist=True)
        cause = "unknown"

    flags = score_integrity_flags(score, wave, survival, citations, spheres)

    get_db().execute(
        """
        INSERT INTO scores
          (player_id, callsign_snapshot, score, wave, survival_time_sec, best_chain, citations, spheres_awakened, cause_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (player["id"], player["callsign"], score, wave, survival, best_chain, citations, spheres, cause),
    )
    get_db().commit()
    log_event(
        "score.submitted",
        "warning" if flags else "info",
        player=player,
        details={
            "score": score,
            "wave": wave,
            "survival_time_sec": survival,
            "best_chain": best_chain,
            "citations": citations,
            "spheres_awakened": spheres,
            "cause_key": cause,
            "integrity_flags": flags,
        },
        persist=True,
    )
    return jsonify({"ok": True, "integrityFlags": flags})


if __name__ == "__main__":
    # For local dev. In production use gunicorn behind Caddy/nginx.
    app.run(host="0.0.0.0", port=5000, debug=True)
