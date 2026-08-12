"""Development environment settings."""

from app.settings.common import CommonSettings


class DevSettings(CommonSettings):
    """Development overrides — verbose logging, debug on."""

    DEBUG_MODE: bool = True
    LOG_LEVEL: str = "DEBUG"
    UNDER_DEVELOPMENT: bool = True
