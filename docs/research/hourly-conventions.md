# Hourly Backend Conventions Reference

Source: `/Users/maqbool/Desktop/mtt_projects/vorreix/hourly` (read-only reference project).
Purpose: canonical patterns to replicate in Nodum. All excerpts verbatim from Hourly.

---

## 1. Repo Layout & Layering

Monorepo: `back/` (FastAPI) + `app/` (Flutter) + `deploy/` (Docker Compose) + root `Makefile` + `.github/workflows/`.

Strict three-layer architecture — never skip layers:

```
Routes (api/) → Services (services/) → DB Selectors (db_selectors/)
```

- **Routes** (`app/api/internal/routes/{domain}/`): HTTP only; map `ServiceResult` → HTTP.
- **Services** (`app/services/{domain}/`): business logic; return `ServiceResult[T]`, never raise for business errors.
- **DB Selectors** (`app/db_selectors/{domain}/`): all DB queries, every one scoped by `user_id`.
- Also: `models/{domain}/`, `schemas/{domain}/`, `core/` (db, redis, s3, logging, celery, middlewares), `dependencies/`, `utils/`, `constants/`, `settings/`, `alembic/`, `tests/{unit,integration,e2e}`, `scripts/`, `docs/`.

API tree is split `api/internal/` (first-party, mounted) vs `api/external/v1/` (webhooks, future). Internal aggregator:

```python
# app/api/internal/main.py
router = APIRouter(prefix="/api/v1")
router.include_router(auth_router, prefix="/auth", tags=["Auth"])
router.include_router(storage_router, prefix="/storage", tags=["Storage"])
...
```

Auth routes are further split per concern: `auth/__init__.py` aggregates `register_routes`, `login_routes`, `password_routes`, `session_routes`, `oauth_routes` into one `APIRouter()`.

---

## 2. App Factory + Middleware Order (`app/main.py`)

`create_app()` factory + `app = create_app()` at module bottom. Lifespan is an `@asynccontextmanager` that calls `setup_logging()`, does infra init (S3 bucket ensure wrapped in `asyncio.to_thread` since boto3 is sync), and on shutdown closes Redis.

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    setup_logging()
    logger.info("app_starting", environment=settings.ENVIRONMENT)
    ...
    yield
    logger.info("app_shutting_down")
    from app.core.redis import close_redis
    await close_redis()
```

Middleware stack — added in reverse of execution order (Starlette executes last-added first):

```python
# Middleware stack (outermost → innermost, added in reverse execution order)
# Execution order: SecurityHeaders → CORS → Logging → RateLimit → Auth → Session
add_cors_middleware(app)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(AuthMiddleware)
app.add_middleware(SessionMiddleware, secret_key=get_settings().SECRET_KEY)
```

After middleware: `register_exception_handlers(app)`, `app.include_router(internal_router)`, admin panel mount, then an inline `/health` endpoint that deep-checks Postgres (`SELECT 1` through `async_session_factory`) and Redis (`ping()`), returning 200/503 with `{"status", "version", "environment", "checks"}`.

Two OpenAPI patches applied by wrapping `app.openapi`:
- `_patch_openapi_file_uploads` — rewrites array-of-file props to `{"type": "string", "format": "binary"}` for Swagger UI.
- `_patch_openapi_security_scheme` — injects a global `BearerAuth` (`http`/`bearer`/`JWT`) scheme; Swagger uses `swagger_ui_parameters={"persistAuthorization": True}`.

---

## 3. Settings Pattern (`app/settings/`)

Three files: `common.py` (CommonSettings), `dev.py` (DevSettings), `production.py` (ProductionSettings). Loader in `__init__.py` switches on `ENVIRONMENT` env var and caches:

```python
@lru_cache
def get_settings() -> DevSettings | ProductionSettings:
    env = os.environ.get("ENVIRONMENT", "development").lower()
    if env == "production":
        return ProductionSettings()
    return DevSettings()
```

(Use `get_settings.cache_clear()` in tests.)

`CommonSettings(BaseSettings)` key points:

```python
model_config = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    env_ignore_empty=True,  # Ignore empty-string env vars (common in Docker)
    case_sensitive=False,
    extra="ignore",
)
```

- Field names are UPPER_SNAKE (`POSTGRES_SERVER`, `JWT_SECRET_KEY`, ...); everything has a default so only genuinely required prod values fail.
- `ENVIRONMENT: Annotated[Literal["dev", "staging", "production"], BeforeValidator(normalize_environment)] = "dev"` — normalizer maps legacy `"development"` → `"dev"`.
- DB URIs are **computed from components**, not stored raw:

```python
@computed_field
@property
def SQLALCHEMY_ASYNC_DATABASE_URI(self) -> str:
    return (
        f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
        f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
    )
```

plus a sync `SQLALCHEMY_DATABASE_URI` (`postgresql+psycopg2://...`) for Alembic offline mode.
- CORS accepts comma-separated string OR JSON list via `BeforeValidator(parse_cors)`; `all_cors_origins` computed field strips trailing slashes.
- `UNDER_DEVELOPMENT: bool` flag → fixed OTP `"123456"`, skip sending real emails.
- `model_post_init` validates `ENCRYPTION_KEYS` (comma-separated Fernet keys, first = primary) — fail fast at boot.
- Rate limit knobs: `RATE_LIMIT_AUTH_REQUESTS: int = 5`, `RATE_LIMIT_AUTH_WINDOW_SECONDS: int = 60`.
- JWT knobs: `JWT_SECRET_KEY`, `JWT_ALGORITHM: str = "HS256"`, `JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15`, `JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7`.

`DevSettings`: `DEBUG_MODE=True`, `LOG_LEVEL="DEBUG"`, `UNDER_DEVELOPMENT=True`, plus `POSTGRES_TEST_*` components and computed `TEST_DATABASE_URI`.

`ProductionSettings`: `DEBUG_MODE=False`, `LOG_LEVEL="WARNING"`, `UNDER_DEVELOPMENT=False`, and a `model_post_init` that **refuses to boot** if any secret still equals a known dev default:

```python
_INSECURE_DEFAULTS: dict[str, str] = {
    "SECRET_KEY": "change-me-in-production",
    "JWT_SECRET_KEY": "jwt-secret-change-me",
    "ADMIN_PASSWORD": "change-me-in-production",
    "S3_ACCESS_KEY": "minioadmin",
    "S3_SECRET_KEY": "minioadmin",
}
```

---

## 4. DB Engine + Session (`app/core/db.py`, `app/dependencies/db.py`)

Module-level engine and factory (no lazy init):

```python
engine = create_async_engine(
    settings.SQLALCHEMY_ASYNC_DATABASE_URI,
    echo=settings.DATABASE_ECHO,
    pool_size=settings.DATABASE_POOL_SIZE,      # default 20
    max_overflow=settings.DATABASE_MAX_OVERFLOW,  # default 10
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
```

FastAPI dependency (duplicated in `dependencies/db.py` — the one routes import):

```python
async def get_async_session() -> AsyncGenerator[AsyncSession]:
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

Note: **services own commits** (`await db.commit()` inside the service after all writes), the dependency only rolls back on exception.

`Base` is a bare `DeclarativeBase` in `app/models/__init__.py`.

---

## 5. Redis Client (`app/core/redis.py`)

Module-level dual clients — async for FastAPI, sync for Celery:

```python
_async_pool = aioredis.ConnectionPool.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    max_connections=50,
)
redis_client: aioredis.Redis = aioredis.Redis(connection_pool=_async_pool)

sync_redis_client: sync_redis.Redis = sync_redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
```

Plus `async def get_redis()` (DI convenience) and `close_redis()` (`await redis_client.aclose()`) called in lifespan shutdown. Most code imports `redis_client` directly rather than injecting it.

`utils/cache_utils.py` provides `cache_get/cache_set(key, value, ttl=300)/cache_delete/cache_delete_pattern` — JSON serialization with `default=str`, pattern delete via `scan_iter`.

---

## 6. Logging (`app/core/logging.py`)

structlog with env-dependent renderer:

```python
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer()
        if settings.ENVIRONMENT != "production"
        else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(settings.LOG_LEVEL)),
    ...
)
```

- Quiet noisy loggers: `uvicorn.access`, `sqlalchemy.engine` → WARNING.
- Sentry init only when `ENVIRONMENT == "production" and settings.SENTRY_DSN` (Logging + FastAPI + SQLAlchemy integrations, `traces_sample_rate=0.1`).
- `get_logger(name, **ctx)` returns a bound logger; log calls are event-style: `logger.info("user_logged_in", user_id=str(user.id))`.

---

## 7. Middlewares (`app/core/middlewares/`)

All are `BaseHTTPMiddleware` subclasses except CORS, which is a helper function `add_cors_middleware(app)`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.all_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],   # explicit, never "*"
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)
```

**AuthMiddleware** — extraction only, never enforcement:

```python
request.state.user = None
request.state.token = None
path = request.url.path
is_public = path in PUBLIC_PATHS or path.startswith(PUBLIC_PATH_PREFIXES)
if not is_public:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        request.state.token = auth_header[7:]
    else:
        # Fallback: httpOnly cookie-based auth
        token_from_cookie = request.cookies.get("access_token")
        if token_from_cookie:
            request.state.token = token_from_cookie
```

`PUBLIC_PATHS` is a set of exact paths (`/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, docs, ...); `PUBLIC_PATH_PREFIXES = ("/api/v1/auth/oauth/", "/admin")`. Enforcement lives in route dependencies (`get_current_user_id`).

**RateLimitMiddleware** — Redis fixed-window counter on auth paths only:

```python
if request.url.path in AUTH_PATHS:
    client_ip = request.client.host if request.client else "unknown"
    key = f"rate_limit:{request.url.path}:{client_ip}"
    try:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, settings.RATE_LIMIT_AUTH_WINDOW_SECONDS)
        if current > settings.RATE_LIMIT_AUTH_REQUESTS:
            logger.warning("rate_limited", path=request.url.path, ip=client_ip)
            return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again later."})
    except Exception:
        # If Redis is down, allow the request through
        logger.warning("rate_limit_redis_unavailable")
```

Mechanics: INCR then EXPIRE on first hit (per-path + per-IP key), 5 req / 60 s defaults, **fail-open** when Redis is unavailable. `AUTH_PATHS` = login, register, verify-otp, forgot-password, reset-password.

**LoggingMiddleware** — generates `request_id = str(uuid4())`, stores on `request.state.request_id`, times with `time.perf_counter()`, logs `request_completed` with method/path/status/duration_ms, sets `X-Request-ID` response header.

**SecurityHeadersMiddleware** — always sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`; adds HSTS (`max-age=63072000; includeSubDomains; preload`) only in production.

---

## 8. Auth Flow

### JWT creation (`app/services/auth/token_services.py`)

Access and refresh tokens each carry a fresh `jti` (uuid4) and a `type` discriminator:

```python
payload = {
    "sub": user_id,
    "email": email,
    "jti": jti,
    "type": "access",   # or "refresh"
    "exp": expire,
    "iat": datetime.now(UTC),
}
token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
return token, jti
```

`generate_auth_tokens(user_id, email)` returns `(access_token, access_jti, refresh_token, refresh_jti, expires_in_seconds, refresh_expires_at)`.

### JWT verification (`app/dependencies/auth.py`)

- Algorithm allow-list guards against `alg: none` downgrade: `_ALLOWED_JWT_ALGORITHMS = {"HS256", "HS384", "HS512", "RS256", "RS384", "RS512"}` — 500 if configured algorithm is not in it.
- `_decode_token` raises 401 (`WWW-Authenticate: Bearer`) when token missing; 401 on `JWTError`.
- `get_current_user_id(request) -> UUID` reads `request.state.token` (set by AuthMiddleware), validates `sub` is a UUID.
- `get_current_token_payload(request) -> dict` for endpoints needing the JTI (logout, session mgmt).

### Login (service `auth_service.login`)

lookup by email → `verify_password` (Argon2) → `is_active` check → `generate_auth_tokens` → `create_session` (DB record with both JTIs, device/IP parsed from request) → `update_user_last_login` → `db.commit()` → returns `{"user", "access_token", "refresh_token", "expires_in"}`. Failures are `ServiceResult.failure(ServiceError.AUTH_INVALID_CREDENTIALS / AUTH_USER_DISABLED)` — same error for unknown email and wrong password.

### Refresh rotation (`auth_service.refresh_token`)

```python
payload = jwt.decode(raw_refresh_token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
...
if payload.get("type") != "refresh": return ServiceResult.failure(ServiceError.AUTH_INVALID_TOKEN)
refresh_jti = payload.get("jti")
# Check Redis block list
if await redis_client.exists(f"blocked_jti:{refresh_jti}"): return ServiceResult.failure(...)
session = await get_session_by_refresh_jti(db, refresh_jti)
if not session or not session.is_valid: return ServiceResult.failure(...)
user = await get_user_by_id(db, session.user_id)   # + is_active check
new_access_token, new_access_jti = create_access_token(str(user.id), user.email)
new_refresh_token, new_refresh_jti = create_refresh_token(str(user.id), user.email)
await rotate_session_tokens(db, session.id, new_access_jti, new_refresh_jti)
await db.commit()
```

Order: decode → type check → jti present → Redis blocklist → DB session valid → user active → mint pair → rotate session JTIs in place (old refresh token instantly dead) → commit.

### Logout (`auth_service.logout`)

Find session by access JTI, `invalidate_session_in_db(db, session.id, "user_logout")`, then block BOTH JTIs in Redis with TTLs equal to remaining token lifetimes, via pipeline:

```python
pipe = redis_client.pipeline()
pipe.setex(f"blocked_jti:{access_jti}", access_ttl, "1")
pipe.setex(f"blocked_jti:{refresh_jti}", refresh_ttl, "1")
await pipe.execute()
```

### Session model (`app/models/auth/session.py`)

`Session(UUIDTimeStampMixin, Base)`, table `sessions`. Fields:
- `user_id` (FK users.id, `ondelete="CASCADE"`, indexed)
- `access_token_jti: String(64)` unique + indexed; `refresh_token_jti: String(64)` unique + indexed
- Device: `device_type(20) / device_name(200) / browser(100) / os_name(100) / user_agent(Text)` (parsed from UA)
- Network/geo: `ip_address: String(45)`, `country`, `city`, `latitude/longitude: Float`
- State: `is_active` (default True), `expires_at` (= refresh expiry, tz-aware), `last_login` (`func.now()` + onupdate), `invalidated_at`, `invalidation_reason: String(100)`
- Partial index for hot lookups:

```python
__table_args__ = (
    Index(
        "idx_session_valid_by_user",
        "user_id",
        postgresql_where=("is_active = true AND invalidated_at IS NULL"),
    ),
)
```

- Helper properties `is_expired`, `is_valid` (`is_active and not is_expired and invalidated_at is None`), `location_display`, and `invalidate(reason)` mutator.

### Cookie handling (`app/utils/cookie_utils.py`)

Tokens are delivered as httpOnly cookies (Bearer also accepted). Response bodies of login/refresh do NOT contain tokens — login returns the user profile, refresh returns empty success.

```python
response.set_cookie(
    key=ACCESS_TOKEN_COOKIE,   # "access_token"
    value=access_token,
    httponly=True,
    secure=is_production,
    samesite="lax",
    max_age=access_max_age,
    path="/",
)
```

Route pattern: `set_auth_cookies(response, access_token=..., refresh_token=..., access_max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60, refresh_max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400, is_production=settings.ENVIRONMENT == "production")`. `/auth/refresh` reads `request.cookies.get("refresh_token")` (401 if absent). Logout calls `clear_auth_cookies(response)`.

### Registration (two-step OTP, no unverified users in DB)

Step 1 `POST /register`: check email free → `hash_password` → OTP (`"123456"` when `UNDER_DEVELOPMENT` else `generate_otp()`) → `redis_client.setex(f"registration:{otp_id}", OTP_TTL_SECONDS, json.dumps(payload))` → Celery email task (skipped in dev) → return `{otp_id}` (202).
Step 2 `POST /register/verify-otp`: verify OTP from Redis → race-guard re-check email → `create_user` → `db.flush()` → seed defaults → mint tokens → `create_session` → `db.commit()` → delete Redis key → auto-login response.

Password reset: `forgot_password` always returns success ("If the email exists...") to block enumeration; stores UUID token at `forgot_password:{token}` (TTL 300 s). `reset_password` invalidates ALL sessions (`reason="password_reset"`). `change_password` invalidates all EXCEPT current JTI (`reason="password_changed"`).

Passwords: Argon2 via `argon2-cffi` (`PasswordHasher`), `verify_password` catches `VerifyMismatchError` → False.

---

## 9. ServiceResult Pattern (`app/services/service_response.py`)

```python
@dataclass
class ServiceResult(Generic[T]):
    ok: bool
    data: T | None = None
    error: list[ServiceError] = field(default_factory=list)
    message: str = ""

    @classmethod
    def success(cls, data: T, message: str = "") -> "ServiceResult[T]":
        return cls(ok=True, data=data, message=message)

    @classmethod
    def failure(cls, error: ServiceError, message: str = "") -> "ServiceResult[T]":
        return cls(ok=False, error=[error], message=message or error.value)
```

Also `unwrap()` (data or raise) and `to_http_exception()`, which maps by **substring match on the enum member name**:

```python
status_map: dict[str, int] = {
    "NOT_FOUND": 404, "ALREADY_EXISTS": 409, "CONFLICT": 409,
    "INVALID_CREDENTIALS": 401, "UNAUTHORIZED": 401, "FORBIDDEN": 403,
    "SESSION_NOT_OWNED": 403, "VALIDATION_ERROR": 422,
    "OTP_INVALID": 422, "OTP_EXPIRED": 422, "RATE_LIMITED": 429,
    "SUBSCRIPTION_REQUIRED": 402,
}
status_code = 400  # default for unmatched
for pattern, code in status_map.items():
    if pattern in error.name:
        status_code = code
        break
return HTTPException(status_code=status_code, detail=self.message or error.value)
```

`ServiceError` (`app/services/service_enums.py`) is a single `enum.StrEnum` where the **name encodes the domain + HTTP mapping pattern** and the **value is the human message**:

```python
class ServiceError(enum.StrEnum):
    NOT_FOUND = "Resource not found"
    AUTH_INVALID_CREDENTIALS = "Invalid email or password"
    AUTH_EMAIL_ALREADY_EXISTS = "Email already registered"
    ENTRY_HOUR_CONFLICT = "An entry already exists for this hour"
    TAG_SYSTEM_IMMUTABLE = "System tags cannot be modified or deleted"
    ...
```

New errors must include one of the mapped substrings in their NAME (e.g. `X_NOT_FOUND`, `X_ALREADY_EXISTS`) to get the right status code.

### Full example (service + route)

```python
# service
async def create_entry(db, user_id, ...) -> ServiceResult[HourEntry]:
    if conflict:
        return ServiceResult.failure(ServiceError.ENTRY_HOUR_CONFLICT)
    ...
    await db.commit()
    return ServiceResult.success(entry)

# route
@router.post("", response_class=CustomJSONResponse,
             response_model=BaseResponse[TagResponse], status_code=status.HTTP_201_CREATED)
async def create_tag(
    input_data: CreateTagRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_async_session),
) -> BaseResponse[TagResponse]:
    result = await tag_service.create_tag(db, user_id, name=input_data.name, color=input_data.color)
    if not result.ok:
        raise result.to_http_exception()
    return BaseResponse.success_response(data=TagResponse.model_validate(result.data))
```

---

## 10. Response Envelope (`app/schemas/common/common_schemas.py` + `api/internal/json_encoder.py` + `exceptions.py`)

Every endpoint: `response_class=CustomJSONResponse` + `response_model=BaseResponse[TypedSchema]` (never `BaseResponse[dict]`) + body param named `input_data` + auth via `Depends(get_current_user_id)`.

```python
class BaseResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    message: str = ""
    meta: PaginationMeta | None = None
    error: ErrorDetails | None = None
```

Constructors: `BaseResponse.success_response(data, message="")` and `BaseResponse.failure(code, message, details=None)` (builds `ErrorDetails{code, message, details}`).

Wire format:
- Success: `{"success": true, "data": {...}, "message": "optional"}`
- Error: `{"success": false, "error": {"code": "not_found", "message": "...", "details": [...]}}`

`CustomJSONResponse.render` runs `jsonable_encoder` (UUID/datetime/enums) and **strips null/empty** `message/data/meta/error` keys from envelopes, plus null fields inside `error`.

Global handlers (`register_exception_handlers`) guarantee the envelope for every status:
- `RequestValidationError` → 422, `code="validation_error"`, `details=[{"field", "message"}]` (loc prefix body/query/path/header stripped, field parts joined with `.`), message = `"Validation failed: {field} — {msg}; ..."`.
- `HTTPException` → `code = ERROR_CODE_MAP.get(exc.status_code, "error")`.
- `Exception` → 500, `code="internal_server_error"`, generic message (real error only logged).

Error code map:

```python
ERROR_CODE_MAP: dict[int, str] = {
    400: "bad_request", 401: "unauthorized", 403: "forbidden",
    404: "not_found", 409: "conflict", 422: "validation_error",
    429: "too_many_requests", 500: "internal_server_error",
}
```

So the full chain is: `ServiceError` name → `to_http_exception()` status → global handler → `error.code` string.

---

## 11. Pagination (`app/utils/pagination.py`)

```python
class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]; total: int; page: int; page_size: int; total_pages: int

async def paginate(db: AsyncSession, query: Select[tuple[Any]], params: PaginationParams) -> PaginatedResponse[Any]:
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar_one()
    offset = (params.page - 1) * params.page_size
    result = await db.execute(query.offset(offset).limit(params.page_size))
    items = list(result.scalars().all())
    total_pages = (total + params.page_size - 1) // params.page_size
    return PaginatedResponse(items=items, total=total, page=params.page, page_size=params.page_size, total_pages=total_pages)
```

(There is also `PaginationMeta{limit, offset, total_items}` on the envelope for list endpoints, and `SortParams{sort_by="created_at", sort_order="desc" pattern "^(asc|desc)$"}`, `IDResponse`, `MessageResponse`, `BulkOperationResponse` in common schemas.)

---

## 12. Models & Enums

All models inherit `UUIDTimeStampMixin` (+ `Base`):

```python
class UUIDTimeStampMixin:
    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid7)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now(), nullable=False)
```

**UUID7** primary keys (`uuid_extensions.uuid7`) — time-sortable.

Enum columns: Python `enum.StrEnum`, stored by VALUE via `values_callable`, with both `default` and `server_default`:

```python
_enum_values = lambda cls: [e.value for e in cls]  # noqa: E731

theme: Mapped[ThemeEnum] = mapped_column(
    SAEnum(ThemeEnum, name="theme_enum", values_callable=_enum_values),
    nullable=False,
    default=ThemeEnum.SYSTEM,
    server_default=ThemeEnum.SYSTEM.value,
)
```

Booleans/JSONB always carry `server_default` too (`server_default="false"`, `server_default="{}"`). Relationships use `back_populates`, `cascade="all, delete-orphan"`, `lazy="selectin"`; cross-model type hints under `if TYPE_CHECKING`. Index naming: `idx_{table}_{cols}`, unique `uq_{table}_{col}`.

---

## 13. Alembic (`alembic/env.py` + versions/)

Migration filenames: sequential 4-digit prefix — `0001_6fd72a3b617d_auth_models.py`, `0002_...`. Never modify deployed migrations; always create a new one.

`env.py` custom behaviors (over boilerplate):
1. **Auto-discovers all model modules**: `pkgutil.walk_packages` over `app.models` so any new model file is picked up by autogenerate.
2. **Sequential rev IDs** via `process_revision_directives`: `script.rev_id = f"{seq_num}_{script.rev_id}"` where `seq_num` is scanned from existing `NNNN_*.py` files.
3. **Enum DDL injection**: collects all `sa.Enum` types from metadata, prepends `CREATE TYPE ... AS ENUM (...)` ops to upgrades and appends `DROP TYPE IF EXISTS` to downgrades.
4. **Partition support**: tables declaring `postgresql_partition_by` get HASH partition child `CREATE TABLE ..._pN PARTITION OF ...` SQL stubs; `include_object` filters `_p<N>` children (and their indexes/FKs) out of autogenerate.
5. **URL resolution**: `DATABASE_URL` env var wins (CI override), else `get_settings().SQLALCHEMY_ASYNC_DATABASE_URI`; offline mode swaps `+asyncpg` → `+psycopg2`.
6. **Online mode is async**: `create_async_engine(get_async_url(), poolclass=pool.NullPool)` + `connection.run_sync(do_run_migrations)`; both modes use `compare_type=True`, `render_as_batch=True`, `include_object`, `process_revision_directives`.

`scripts/pre-start.sh` (container entrypoint wrapper): waits up to 30×2 s for Postgres using asyncpg (URL built from `POSTGRES_*` components, falling back to `DATABASE_URL` with the `+asyncpg` prefix stripped), runs `uv run alembic upgrade head`, then `exec "$@"` (uvicorn).

---

## 14. Testing

`pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --tb=short"
```

Root `tests/conftest.py` — httpx ASGI client with rate limiter neutralized by patching the module-level Redis client:

```python
@pytest.fixture
async def client() -> AsyncClient:
    mock_redis = AsyncMock()
    mock_redis.incr = AsyncMock(return_value=1)
    mock_redis.expire = AsyncMock(return_value=True)
    with patch("app.core.middlewares.rate_limit_middleware.redis_client", mock_redis):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
```

Unit-test style: patch the service at the **route module's import site** (`patch("app.api.internal.routes.auth.register_routes.auth_service")`), return real `ServiceResult` objects, assert on the envelope (`body["success"]`, `body["error"]["code"]`, `"data" not in body` for errors). Mock users built by a `_make_mock_user(**overrides)` MagicMock helper. Directories `tests/unit/`, `tests/integration/`, `tests/e2e/`; classes `Test{Entity}`, functions `test_{scenario}`. Dev group deps: pytest, pytest-asyncio, pytest-cov, httpx, factory-boy, ruff, pre-commit, ty.

---

## 15. Deploy / Compose

`deploy/compose.sh` — env-selecting wrapper: `./compose.sh {dev|test|prod} [args...]`. It sources `deploy/.env` with `set -a`, then dispatches to `docker compose -f docker-compose.yml -f docker-compose.{env}.yml --project-name hourly-{env} "$@"`. The base file defines infra; overlays customize.

Base `docker-compose.yml`: Postgres (`pgvector/pgvector:0.8.0-pg16`), Redis (`redis:7.4.2-alpine` with maxmemory 256mb / allkeys-lru), MinIO (pinned release), Flower — all with healthchecks, all host ports bound to `127.0.0.1:` only, shared `app_network`, named volumes.

`docker-compose.dev.yml`: api + celery-worker built from `back/build/Dockerfile.api` `target: development`, env inline (`POSTGRES_SERVER=postgres`, `REDIS_URL=redis://redis:6379/0`, broker db 1, result backend db 2, `ENVIRONMENT=development`, `UNDER_DEVELOPMENT=true`), source bind-mounted `../back:/app` with a named-volume venv shadow (`api_venv:/app/.venv`), `depends_on: condition: service_healthy`, command `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`.

`docker-compose.test.yml`: tiny overlay — `POSTGRES_DB: hourly_test` and `tmpfs` mounts on Postgres data dir and Redis `/data` (ephemeral, fast, nothing persists).

Root `Makefile` is the command center: `dev/dev-d` (full Docker), `ldev*` (infra in Docker + API on host), `tenv-up/tenv-down` (test infra), `test/test-unit/test-cov`, `lint/format/typecheck`, `migrate/migrate-new MSG=.../migrate-down/migrate-history`, `pr` (pre-commit + `scripts/lint.sh` (ruff check + format + ty) + pytest + Flutter checks), `br <name>` (creates `feature/<name>` with a `%:` catch-all target).

---

## 16. CI (`.github/workflows/ci-backend.yml`)

Concurrency group `ci-backend-${{ github.ref }}` with `cancel-in-progress: true`. Triggers: push to main, PR opened/synchronize, manual.

1. **lint** job: checkout → setup-python 3.13 → `astral-sh/setup-uv@v7` with cache → `uv sync --all-extras` (in `back/`) → `uv run bash scripts/lint.sh` (ruff check + ruff format --check + ty).
2. **security-audit** job (parallel, `continue-on-error: true`): `uvx pip-audit`.
3. **test** job (`needs: lint`): service containers `postgres:16` and `redis:7` with healthchecks; env sets `POSTGRES_*` components, `REDIS_URL`, `SECRET_KEY`/`JWT_SECRET_KEY` CI values, `ENVIRONMENT: dev`, `UNDER_DEVELOPMENT: "true"`; runs `uv run pytest tests/ --cov=app --cov-report=xml -q`; uploads `coverage.xml` artifact with `if: always()`.

Pre-commit (`.pre-commit-config.yaml`): ruff (`--fix`) + ruff-format scoped `files: ^back/`; standard hygiene hooks (trailing-whitespace, end-of-file-fixer, check-yaml/json/toml, check-added-large-files 500kb, check-merge-conflict, detect-private-key); local `commit-msg-format` hook running `scripts/check-commit-msg.sh` (emoji commit format `<platform> <type_emoji>: <type>(scope): message` — warns, doesn't block).

---

## 17. Tooling Conventions (pyproject)

- Python `>=3.13`, uv-managed, hatchling build with `packages = ["app"]`.
- Ruff: `target-version = "py313"`, `line-length = 120`, `src = ["app"]`, select `E,W,F,I,B,C4,UP,SIM,TCH,RUF`, ignore `E501` (formatter), `B008` (FastAPI Depends), `UP046/UP047` (Pydantic generics compat). isort `known-first-party = ["app"]`. Format: double quotes, spaces, `docstring-code-format = true`.
- Type check via `ty` (`[tool.ty.environment] python-version = "3.13"`); mypy target also exists in Makefile. Inline `# type: ignore[...]` comments used where Starlette/FastAPI typing fights ty.
- Key libs: fastapi, uvicorn[standard], sqlalchemy[asyncio]+asyncpg, alembic, pydantic[email]+pydantic-settings, python-jose[cryptography], argon2-cffi, redis[hiredis] (<6.5, kombu cap), httpx, celery[redis]+redbeat+flower, boto3, structlog, sentry-sdk[fastapi], uuid7, sqladmin.
- Code style: full type annotations on ALL functions (params + return); all imports at file top (stdlib → third-party → local); Google-style docstrings with Args/Returns/Raises; files `snake_case.py`, classes `PascalCase`, constants `UPPER_SNAKE_CASE`.
- Infra exceptions only (`core/custom_exceptions.py`): `HourlyBaseException` base + specific subclasses (e.g. `ExternalAPIError(service, message)`); business errors NEVER raise — they use ServiceResult.
