"""Production environment settings."""

from pydantic import model_validator

from app.settings.common import CommonSettings

_PLACEHOLDER_FRAGMENTS = ("change-me", "changeme", "secret-change", "dev-only", "test-secret")

# Values shipped in .env.example and the compose defaults. They are published
# in a public repo, so booting production with any of them is the same as
# having no credential at all.
_DEFAULT_CREDENTIALS = frozenset({"nodum", "minioadmin", "postgres", "password", "admin", "changeme"})

# Compose maps some settings from differently-named .env variables. Report the
# name the operator actually edits, or the error sends them to the wrong line.
_ENV_VAR_NAMES = {"S3_SECRET_KEY": "MINIO_ROOT_PASSWORD", "S3_ACCESS_KEY": "MINIO_ROOT_USER"}


class ProductionSettings(CommonSettings):
    """Production overrides — strict defaults, fail-fast on placeholder secrets."""

    DEBUG_MODE: bool = False
    LOG_LEVEL: str = "INFO"
    UNDER_DEVELOPMENT: bool = False

    @model_validator(mode="after")
    def _reject_placeholder_secrets(self) -> "ProductionSettings":
        """A public repo ships known defaults — refusing to boot with them
        closes the door on accidental auth-bypass deployments."""
        # The data-store credentials, which this guard used to skip entirely.
        # An operator following the documented "copy .env.example, then fix
        # whatever it complains about" loop otherwise ends up in production
        # with minioadmin:minioadmin on the bucket holding every user's
        # attachments, and nodum:nodum on the database — both published here.
        for field in ("POSTGRES_PASSWORD", "S3_SECRET_KEY"):
            value = getattr(self, field, "")
            if (
                value.lower() in _DEFAULT_CREDENTIALS
                or len(value) < 12
                or any(fragment in value.lower() for fragment in _PLACEHOLDER_FRAGMENTS)
            ):
                raise ValueError(
                    f"{_ENV_VAR_NAMES.get(field, field)} is a known default or too short. Generate one: "
                    'python3 -c "import secrets; print(secrets.token_urlsafe(24))"'
                )

        for field in ("SECRET_KEY", "JWT_SECRET_KEY"):
            value = getattr(self, field, "")
            if len(value) < 32 or any(fragment in value.lower() for fragment in _PLACEHOLDER_FRAGMENTS):
                raise ValueError(
                    f"{field} is unset or a placeholder. Generate one: "
                    'python3 -c "import secrets; print(secrets.token_hex(32))"'
                )
        # AI is optional, so an empty key is allowed — it simply turns the
        # feature off. A weak one is not: it would encrypt users' provider keys
        # with something guessable.
        if self.AI_ENCRYPTION_KEY and (
            len(self.AI_ENCRYPTION_KEY) < 32
            or any(fragment in self.AI_ENCRYPTION_KEY.lower() for fragment in _PLACEHOLDER_FRAGMENTS)
        ):
            raise ValueError(
                "AI_ENCRYPTION_KEY is a placeholder or too short. Generate one: "
                'python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        return self
