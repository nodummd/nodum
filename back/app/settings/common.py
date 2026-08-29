"""Common settings shared across all environments.

Settings are loaded from environment variables using Pydantic Settings v2.
Priority: process env vars > .env file > field defaults.

Database URIs are computed from component settings (POSTGRES_*) rather than
stored as raw strings, making individual credential changes easier.
"""

from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BeforeValidator, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR: Path = Path(__file__).resolve().parent.parent


def parse_cors(v: Any) -> list[str] | str:
    """Parse CORS origins from a comma-separated string or a JSON-style list."""
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


def normalize_environment(v: str) -> str:
    """Map legacy 'development' value to 'dev'."""
    return "dev" if v == "development" else v


class CommonSettings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,  # Ignore empty-string env vars (common in Docker)
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    APP_NAME: str = "Nodum"
    APP_VERSION: str = "3.7.0"
    ENVIRONMENT: Annotated[
        Literal["dev", "test", "staging", "production"],
        BeforeValidator(normalize_environment),
    ] = "dev"
    DEBUG_MODE: bool = False
    LOG_LEVEL: str = "INFO"
    # Long enough that HS256 never sees an under-strength HMAC key (PyJWT
    # raises InsecureKeyLengthWarning below 32 bytes), while still carrying the
    # "change-me" fragment ProductionSettings refuses to boot on.
    SECRET_KEY: str = "change-me-in-production-this-default-is-not-a-secret"

    # ── Database (component-based) ────────────────────────────────────────────
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "nodum"
    POSTGRES_PASSWORD: str = "nodum"
    POSTGRES_DB: str = "nodum"
    DATABASE_ECHO: bool = False
    # Per-worker pool: 4 uvicorn workers x (10 + 5) = 60 connections, safely
    # under stock Postgres max_connections=100 (leaves room for celery + psql).
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 5

    @computed_field
    @property
    def SQLALCHEMY_ASYNC_DATABASE_URI(self) -> str:
        """Async database URI for FastAPI endpoints (asyncpg)."""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        """Sync database URI for Alembic (psycopg driver not installed — asyncpg used via env.py)."""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    # Control-plane Redis (rate limits, auth revocation/grace). Defaults to the
    # cache server's logical DB 3; point at a dedicated noeviction instance in prod.
    REDIS_CONTROL_URL: str | None = None

    # Google OAuth (empty = feature hidden; see docs/OWNER-SETUP.md)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    # Public origin the OAuth callback redirects through (the web app origin)
    OAUTH_REDIRECT_BASE_URL: str = "http://localhost:3100"

    # ── Google data sync (Calendar, Gmail) ───────────────────────────────
    # A *separate* OAuth client from sign-in above, because the scopes and the
    # verification tier are different and mixing them would drag the login
    # client into Gmail's compliance regime.
    #
    # These are deliberately not defaulted to the sign-in client and are never
    # shipped with values: the Google APIs Terms of Service forbid embedding
    # developer credentials in an open-source project, so a self-hosted
    # instance must register its own Cloud project. docs/OWNER-SETUP.md walks
    # through it — including the step people miss, which is setting the consent
    # screen to "In production". Left in "Testing", Google expires every
    # refresh token after 7 days and background sync dies silently.
    GOOGLE_SYNC_CLIENT_ID: str = ""
    GOOGLE_SYNC_CLIENT_SECRET: str = ""

    # Gmail is SELF-HOSTED ONLY and off by default.
    #
    # Every Gmail scope — including gmail.metadata — is on Google's
    # *restricted* list, which obliges a hosted, multi-user deployment to pass
    # a CASA security assessment by an authorised lab, renewed annually and
    # priced from roughly $540 to several thousand dollars a year. An operator
    # running Nodum for themselves is covered by Google's personal-use
    # exemption and owes none of that. Calendar's scopes are merely
    # *sensitive*, so they carry a one-time review and no fee — which is why
    # Calendar ships on by default and Gmail does not.
    GOOGLE_SYNC_GMAIL_ENABLED: bool = False

    # How often the beat scheduler looks for connections that are due a poll.
    PROVIDER_SYNC_TICK_SECONDS: int = 60
    # Default per-stream poll interval; adapters may raise their own.
    PROVIDER_SYNC_DEFAULT_INTERVAL: int = 300

    # Live collaboration (Yjs rooms over websockets)
    COLLAB_ENABLED: bool = True

    # ── Community forum ──────────────────────────────────────
    # Set once at first deploy: this email's account becomes staff on startup
    # (idempotent; the column is the ongoing truth, more staff via SQL/UI later).
    COMMUNITY_BOOTSTRAP_STAFF_EMAIL: str = ""
    COMMUNITY_POST_MAX_CHARS: int = 64_000
    COLLAB_PERSIST_INTERVAL_SECONDS: float = 3.0
    # Cache TTLs (seconds)
    CACHE_GRAPH_TTL: int = 300
    CACHE_TREE_TTL: int = 300

    # ── JWT ───────────────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str = "jwt-secret-change-me-this-default-is-not-a-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── AI (bring your own key) ───────────────────────────────────────────────
    # Encrypts users' third-party provider keys at rest. Its own setting rather
    # than SECRET_KEY: rotating this one makes stored credentials unreadable, so
    # it must not ride on a value operators treat as freely rotatable.
    # Generate: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    AI_ENCRYPTION_KEY: str = ""
    # Encrypts stored OAuth refresh tokens for synced data sources. Its own key
    # so the blast radius of a rotation or a leak does not span two features;
    # falls back to AI_ENCRYPTION_KEY when unset, so an existing deployment
    # keeps working without being forced to generate a second secret first.
    OAUTH_ENCRYPTION_KEY: str = ""
    # Ceiling on a single AI request, in seconds — a provider hanging must not
    # hold a worker forever.
    AI_REQUEST_TIMEOUT: int = 120
    # A user-supplied provider base_url is a URL the *server* fetches, so by
    # default it may not resolve to a private, loopback, link-local or reserved
    # address — otherwise any signed-up user can probe the cloud metadata
    # endpoint or the compose network from inside the API container.
    # Turn this on only on a single-tenant/self-hosted install, where pointing
    # at http://ollama:11434/v1 is the whole point.
    AI_ALLOW_PRIVATE_BASE_URLS: bool = False

    # ── S3 / MinIO (attachments) ──────────────────────────────────────────────
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_PUBLIC_URL: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET_NAME: str = "nodum"
    S3_REGION: str = "us-east-1"
    S3_PRESIGNED_URL_EXPIRY_TIME: int = 3600

    # ── Celery ────────────────────────────────────────────────────────────────
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # ── URLs & CORS ───────────────────────────────────────────────────────────
    BACKEND_BASE_URL: str = "http://localhost:8000"
    FRONTEND_BASE_URL: str = "http://localhost:3000"
    BACKEND_CORS_ORIGINS: Annotated[list[str] | str, BeforeValidator(parse_cors)] = "http://localhost:3000"

    @computed_field
    @property
    def all_cors_origins(self) -> list[str]:
        """CORS origins as a normalized list."""
        origins = self.BACKEND_CORS_ORIGINS
        return [o.rstrip("/") for o in (origins if isinstance(origins, list) else [origins])]

    # ── Rate limiting ─────────────────────────────────────────────────────────
    RATE_LIMIT_AUTH_REQUESTS: int = 5
    RATE_LIMIT_AUTH_WINDOW_SECONDS: int = 60
    USER_RATE_LIMIT_REQUESTS_PER_MINUTE: int = 300
    USER_RATE_LIMIT_WINDOW_SECONDS: int = 60
    # True when the API sits behind a trusted reverse proxy: rate limiting then
    # reads the client address out of X-Forwarded-For instead of using the
    # proxy's socket IP (which would put every user in one shared bucket).
    # Leave false when nothing trusted sits in front — the header is
    # client-writable, so trusting it without a proxy is a rate-limit bypass.
    TRUST_PROXY_HEADERS: bool = False
    # How many trusted proxies sit between the client and this app. The client
    # address is read this many entries from the RIGHT of X-Forwarded-For, so a
    # client-supplied prefix cannot displace it. 1 = a single reverse proxy
    # (the shipped topology: Caddy/nginx, or the Next.js rewrite). Raise it if
    # you add a CDN in front, or the CDN's address becomes the client.
    TRUSTED_PROXY_HOPS: int = 1

    # ── Email delivery ────────────────────────────────────────────────────────
    # Ordered failover chain (see services/email_service.py). Each name is tried
    # in turn, so listing several both survives an outage and stacks the free
    # tiers: the request that trips Brevo's daily cap goes to Mailjet, and so on.
    # Providers without credentials are skipped.
    EMAIL_PROVIDERS: str = "brevo,mailjet,resend,mailgun,smtp"
    EMAIL_FROM_ADDRESS: str = "no-reply@nodum.md"
    EMAIL_FROM_NAME: str = "Nodum"
    EMAIL_TIMEOUT_SECONDS: float = 10.0

    BREVO_API_KEY: str = ""
    MAILJET_API_KEY: str = ""
    MAILJET_API_SECRET: str = ""
    RESEND_API_KEY: str = ""
    MAILGUN_API_KEY: str = ""
    MAILGUN_DOMAIN: str = ""
    MAILGUN_REGION: str = "us"  # "eu" for EU-hosted Mailgun domains
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_USE_SSL: bool = False

    # ── Email verification ────────────────────────────────────────────────────
    # On everywhere by default, so the signup flow is the same shape in dev as
    # in production. Outside production no mail is sent and the code is fixed
    # (below), so this costs a local developer one extra keystroke. Production
    # refuses to boot with this on and no email provider configured; a
    # self-hoster who wants unverified signups sets it to false.
    EMAIL_VERIFICATION_REQUIRED: bool = True
    # Outside production no mail is sent and the code is always this one, so the
    # flow stays exercisable (and testable) without a mailbox. Production
    # ignores it entirely and issues a random code.
    EMAIL_OTP_DEV_CODE: str = "123456"
    EMAIL_OTP_TTL_MINUTES: int = 15
    EMAIL_OTP_MAX_ATTEMPTS: int = 5
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS: int = 60

    # ── Monitoring ────────────────────────────────────────────────────────────
    # Empty disables error reporting entirely (the default, and what every
    # dev/test run uses). Set it and app.main wires up sentry-sdk.
    SENTRY_DSN: str = ""
    # Errors only by default. Tracing is opt-in because every sampled
    # transaction is billed and this app's hot paths are chatty.
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    # ── Semantic search ───────────────────────────────────────────────────────
    # hash (default, offline) | openai (needs OPENAI_API_KEY; same 384-dim column)
    EMBEDDINGS_PROVIDER: str = "hash"
    OPENAI_API_KEY: str = ""

    # ── Development mode ──────────────────────────────────────────────────────
    UNDER_DEVELOPMENT: bool = False
