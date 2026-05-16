from __future__ import annotations

import os
import re
from pathlib import Path


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("MVF_DB_PATH", BASE_DIR / "instance" / "metatron-vector-foil.sqlite3"))

# Identity and public leaderboard policy.
CALLSIGN_RE = re.compile(r"^[A-Za-z0-9]{3}$")
DEV_AUTH_ENABLED = env_bool("MVF_DEV_AUTH_ENABLED", False)
DEV_AUTH_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,48}$")
LEADERBOARD_DEFAULT_LIMIT = 10
LEADERBOARD_MAX_LIMIT = 50
VALID_CAUSES = {"shrapnel", "enemy", "well", "sol", "fuel", "collapse", "oort", "unknown"}

# Google OpenID Connect / OAuth login. The production flow is server-side only.
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
GOOGLE_OAUTH_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
GOOGLE_OAUTH_SCOPES = tuple(
    scope for scope in os.environ.get("GOOGLE_OAUTH_SCOPES", "openid email profile").split() if scope
)
GOOGLE_OAUTH_ENABLED = env_bool(
    "MVF_GOOGLE_OAUTH_ENABLED",
    bool(GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET),
)
GOOGLE_OAUTH_ALLOWED_HD = os.environ.get("GOOGLE_OAUTH_ALLOWED_HD", "").strip()
GOOGLE_OAUTH_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_STATE_TTL_SECONDS = int(os.environ.get("MVF_OAUTH_STATE_TTL_SECONDS", "600"))
GOOGLE_OAUTH_TOKEN_TIMEOUT_SECONDS = float(os.environ.get("MVF_OAUTH_TOKEN_TIMEOUT_SECONDS", "8"))
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

# Request, session, and body limits.
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,80}$")
MAX_CONTENT_LENGTH_BYTES = 32 * 1024
FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY")
SESSION_COOKIE_SAMESITE = os.environ.get("MVF_COOKIE_SAMESITE", "Lax")
SESSION_COOKIE_SECURE = env_bool("MVF_COOKIE_SECURE", False)
ENABLE_HSTS = env_bool("MVF_ENABLE_HSTS", False)

# Logging and audit policy.
LOG_LEVEL = os.environ.get("MVF_LOG_LEVEL", "INFO")
LOG_PEPPER = os.environ.get("MVF_LOG_PEPPER") or FLASK_SECRET_KEY
IDENTITY_PEPPER = os.environ.get("MVF_IDENTITY_PEPPER") or FLASK_SECRET_KEY
LOG_JSON = env_bool("MVF_LOG_JSON", True)
LOG_PATH = os.environ.get("MVF_LOG_PATH")
LOG_MAX_BYTES = int(os.environ.get("MVF_LOG_MAX_BYTES", str(2 * 1024 * 1024)))
LOG_BACKUPS = int(os.environ.get("MVF_LOG_BACKUPS", "5"))
LOG_STATIC_REQUESTS = env_bool("MVF_LOG_STATIC", False)
ACCEPT_CLIENT_DEBUG_LOGS = env_bool("MVF_ACCEPT_CLIENT_DEBUG_LOGS", False)
LOG_STRING_MAX_CHARS = 512
LOG_DICT_MAX_ITEMS = 40
LOG_LIST_MAX_ITEMS = 12
LOG_MAX_DEPTH = 4
VALID_LOG_SEVERITIES = {"debug", "info", "warning", "error", "critical"}
CLIENT_EVENT_TYPES = {
    "client.startup",
    "client.api_error",
    "client.score_submission_error",
    "client.audio_error",
    "client.render_error",
}
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
    "oauth_state",
    "oauth_nonce",
    "nonce",
    "sub",
    "subject",
    "email",
    "name",
    "avatar",
}

# API rate limits, in seconds between accepted requests per browser session.
CALLSIGN_RATE_LIMIT_SECONDS = 0.75
DEV_AUTH_RATE_LIMIT_SECONDS = 0.75
OAUTH_LOGIN_RATE_LIMIT_SECONDS = 0.75
CLIENT_EVENT_RATE_LIMIT_SECONDS = 0.35
SCORE_SUBMIT_RATE_LIMIT_SECONDS = 1.25

# Security headers. React currently uses inline style attributes, so style-src keeps unsafe-inline.
CONTENT_SECURITY_POLICY = "; ".join(
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
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=()"
