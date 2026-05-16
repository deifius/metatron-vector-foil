from __future__ import annotations

import hashlib
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
import secrets
import sqlite3
import time
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import urlsplit

from flask import Flask, Response, abort, g, jsonify, render_template, request, session
from werkzeug.exceptions import HTTPException, InternalServerError
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("MVF_DB_PATH", BASE_DIR / "instance" / "metatron-vector-foil.sqlite3"))
CALLSIGN_RE = re.compile(r"^[A-Za-z0-9]{3}$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,80}$")
VALID_CAUSES = {"shrapnel", "enemy", "well", "sol", "fuel", "collapse", "oort", "unknown"}
CLIENT_EVENT_TYPES = {
    "client.startup",
    "client.api_error",
    "client.score_submission_error",
    "client.audio_error",
    "client.render_error",
}
VALID_LOG_SEVERITIES = {"debug", "info", "warning", "error", "critical"}
SENSITIVE_LOG_KEYS = {
    "authorization",
    "cookie",
    "csrf",
    "csrftoken",
    "csrf_token",
    "password",
    "secret",
    "session",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "google_sub",
    "email",
    "name",
    "avatar",
}

app = Flask(__name__, static_folder="static", template_folder="templates")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# A production deployment MUST set FLASK_SECRET_KEY in the service environment.
# The generated development key keeps local sessions working without committing a secret.
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_urlsafe(48)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=os.environ.get("MVF_COOKIE_SAMESITE", "Lax"),
    SESSION_COOKIE_SECURE=os.environ.get("MVF_COOKIE_SECURE", "0") == "1",
    JSON_SORT_KEYS=False,
    MAX_CONTENT_LENGTH=32 * 1024,
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
    level_name = os.environ.get("MVF_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    app.logger.setLevel(level)
    app.logger.handlers.clear()

    formatter: logging.Formatter
    if os.environ.get("MVF_LOG_JSON", "1") == "1":
        formatter = JsonFormatter()
    else:
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")

    log_path = os.environ.get("MVF_LOG_PATH")
    if log_path:
        path = Path(log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = RotatingFileHandler(
            path,
            maxBytes=int(os.environ.get("MVF_LOG_MAX_BYTES", str(2 * 1024 * 1024))),
            backupCount=int(os.environ.get("MVF_LOG_BACKUPS", "5")),
            encoding="utf-8",
        )
    else:
        handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.setLevel(level)
    app.logger.addHandler(handler)
    app.logger.propagate = False


setup_logging()


def log_secret() -> bytes:
    configured = os.environ.get("MVF_LOG_PEPPER") or os.environ.get("FLASK_SECRET_KEY") or app.secret_key
    return str(configured).encode("utf-8")


def stable_hash(value: str | None, purpose: str) -> str | None:
    if not value:
        return None
    digest = hmac.new(log_secret(), f"{purpose}:{value}".encode("utf-8", "replace"), hashlib.sha256).hexdigest()
    return digest[:32]


def request_id() -> str:
    incoming = request.headers.get("X-Request-ID", "")
    if REQUEST_ID_RE.fullmatch(incoming):
        return incoming
    return uuid.uuid4().hex


def sanitize_for_log(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "[max_depth]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.replace("\r", "\\r").replace("\n", "\\n")
        if len(cleaned) > 512:
            return cleaned[:512] + "…"
        return cleaned
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (key, item) in enumerate(value.items()):
            if i >= 40:
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
        return [sanitize_for_log(item, depth + 1) for item in list(value)[:12]]
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
    csp = "; ".join(
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
            "img-src 'self' data: https:",
            "media-src 'self'",
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )
    resp.headers.setdefault("Content-Security-Policy", csp)
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=()")
    resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if os.environ.get("MVF_ENABLE_HSTS", "0") == "1":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers.setdefault("X-Request-ID", getattr(g, "request_id", ""))
    emit_access_log(resp)
    return resp


def emit_access_log(resp: Response) -> None:
    duration_ms = round((time.perf_counter() - float(getattr(g, "request_started_at", time.perf_counter()))) * 1000, 2)
    is_static = request.path.startswith("/static/")
    if is_static and resp.status_code < 400 and os.environ.get("MVF_LOG_STATIC", "0") != "1":
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


def current_player() -> sqlite3.Row | None:
    db = get_db()
    google_sub = session.get("google_sub")
    if google_sub:
        row = db.execute("SELECT * FROM players WHERE google_sub = ?", (google_sub,)).fetchone()
        if row:
            return row
    anon = session.get("anonymous_id")
    if anon:
        return db.execute("SELECT * FROM players WHERE anonymous_id = ?", (anon,)).fetchone()
    return None


def public_player_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    return {
        "authenticated": bool(session.get("google_sub")),
        "authProvider": "google" if session.get("google_sub") else "session",
        "callsign": row["callsign"] if row and row["callsign"] else None,
    }


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



@app.post("/api/client-events")
@require_csrf
def client_events():
    session_rate_limit("client_events", 0.35)
    data = json_body()
    event_type = str(data.get("eventType", "client.unknown"))
    if event_type not in CLIENT_EVENT_TYPES:
        event_type = "client.unknown"
    severity = str(data.get("severity", "info")).lower()
    if severity not in VALID_LOG_SEVERITIES:
        severity = "info"
    if severity == "debug" and os.environ.get("MVF_ACCEPT_CLIENT_DEBUG_LOGS", "0") != "1":
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
            "identityPolicy": {
                "publicIdentifier": "3-character case-sensitive callsign",
                "publicFields": ["callsign", "score", "wave", "survivalTimeSec", "createdAt"],
                "googleDataStored": ["sub only, when Google OAuth is enabled"],
                "googleDataNotStored": ["email", "name", "avatar", "access_token", "refresh_token"],
            },
        }
    )


@app.post("/api/player/callsign")
@require_csrf
def set_callsign():
    session_rate_limit("callsign", 0.75)
    data = json_body()
    callsign = str(data.get("callsign", ""))
    if not CALLSIGN_RE.fullmatch(callsign):
        abort(400, "callsign_must_be_exactly_3_case_sensitive_ascii_letters_or_digits")

    db = get_db()
    existing = db.execute("SELECT id FROM players WHERE callsign = ? COLLATE BINARY", (callsign,)).fetchone()
    me = current_player()
    if existing and (me is None or existing["id"] != me["id"]):
        log_event("player.callsign_taken", "warning", player=me, details={"requested_callsign": callsign}, persist=True)
        abort(409, "callsign_taken")

    anon = session["anonymous_id"]
    google_sub = session.get("google_sub")
    if me:
        db.execute("UPDATE players SET callsign = ?, updated_at = datetime('now') WHERE id = ?", (callsign, me["id"]))
    else:
        db.execute(
            "INSERT INTO players (google_sub, anonymous_id, callsign) VALUES (?, ?, ?)",
            (google_sub, anon, callsign),
        )
    db.commit()
    updated_player = current_player()
    log_event("player.callsign_set", "info", player=updated_player, details={"callsign": callsign}, persist=True)
    return jsonify({"ok": True, "player": public_player_payload(updated_player)})


@app.get("/api/leaderboard")
def leaderboard():
    limit = parse_int(request.args, "limit", 10, 1, 50)  # type: ignore[arg-type]
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
    session_rate_limit("score", 1.25)
    player = current_player()
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
