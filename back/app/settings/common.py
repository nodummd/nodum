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
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: Annotated[
        Literal["dev", "test", "staging", "production"],
        BeforeValidator(normalize_environment),
    ] = "dev"
    DEBUG_MODE: bool = False
    LOG_LEVEL: str = "INFO"
    SECRET_KEY: str = "change-me-in-production"

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
    # Cache TTLs (seconds)
    CACHE_GRAPH_TTL: int = 300
    CACHE_TREE_TTL: int = 300

    # ── JWT ───────────────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str = "jwt-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

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
    # True when the API sits behind a trusted reverse proxy (prod compose):
    # rate limiting then keys on the first X-Forwarded-For hop instead of the
    # proxy's socket IP (which would put every user in one shared bucket).
    TRUST_PROXY_HEADERS: bool = False

    # ── Monitoring ────────────────────────────────────────────────────────────
    SENTRY_DSN: str = ""

    # ── Semantic search ───────────────────────────────────────────────────────
    # hash (default, offline) | openai (needs OPENAI_API_KEY; same 384-dim column)
    EMBEDDINGS_PROVIDER: str = "hash"
    OPENAI_API_KEY: str = ""

    # ── Development mode ──────────────────────────────────────────────────────
    UNDER_DEVELOPMENT: bool = False
