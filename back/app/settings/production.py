"""Production environment settings."""

from app.settings.common import CommonSettings


class ProductionSettings(CommonSettings):
    """Production overrides — strict defaults."""

    DEBUG_MODE: bool = False
    LOG_LEVEL: str = "INFO"
    UNDER_DEVELOPMENT: bool = False
