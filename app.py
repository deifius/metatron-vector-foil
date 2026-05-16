from __future__ import annotations

import os
import re
import secrets
import sqlite3
import time
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import urlsplit

from flask import Flask, Response, abort, g, jsonify, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("MVF_DB_PATH", BASE_DIR / "instance" / "metatron-vector-foil.sqlite3"))
CALLSIGN_RE = re.compile(r"^[A-Za-z0-9]{3}$")
VALID_CAUSES = {"shrapnel", "enemy", "well", "sol", "fuel", "collapse", "oort", "unknown"}

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
        """
    )
    db.commit()


@app.before_request
def before_request() -> None:
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
    return resp


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(409)
@app.errorhandler(413)
@app.errorhandler(429)
def api_error(err: Any):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": getattr(err, "description", "request_failed")}), getattr(err, "code", 500)
    return err


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
    return jsonify({"ok": True, "player": public_player_payload(current_player())})


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
        cause = "unknown"

    get_db().execute(
        """
        INSERT INTO scores
          (player_id, callsign_snapshot, score, wave, survival_time_sec, best_chain, citations, spheres_awakened, cause_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (player["id"], player["callsign"], score, wave, survival, best_chain, citations, spheres, cause),
    )
    get_db().commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    # For local dev. In production use gunicorn behind Caddy/nginx.
    app.run(host="0.0.0.0", port=5000, debug=True)
