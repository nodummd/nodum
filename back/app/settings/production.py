"""Production environment settings."""

from pydantic import model_validator

from app.settings.common import CommonSettings

_PLACEHOLDER_FRAGMENTS = ("change-me", "changeme", "secret-change", "dev-only", "test-secret")


class ProductionSettings(CommonSettings):
    """Production overrides — strict defaults, fail-fast on placeholder secrets."""

    DEBUG_MODE: bool = False
    LOG_LEVEL: str = "INFO"
    UNDER_DEVELOPMENT: bool = False

    @model_validator(mode="after")
    def _reject_placeholder_secrets(self) -> "ProductionSettings":
        """A public repo ships known defaults — refusing to boot with them
        closes the door on accidental auth-bypass deployments."""
        for field in ("SECRET_KEY", "JWT_SECRET_KEY"):
            value = getattr(self, field, "")
            if len(value) < 32 or any(fragment in value.lower() for fragment in _PLACEHOLDER_FRAGMENTS):
                raise ValueError(
                    f"{field} is unset or a placeholder. Generate one: "
                    'python3 -c "import secrets; print(secrets.token_hex(32))"'
                )
        return self
