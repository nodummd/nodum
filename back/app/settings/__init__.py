"""Settings loader — selects the settings class from ENVIRONMENT."""

import os
from functools import lru_cache

from app.settings.common import CommonSettings
from app.settings.dev import DevSettings
from app.settings.production import ProductionSettings


@lru_cache
def get_settings() -> CommonSettings:
    """Return the cached settings instance for the current environment."""
    environment = os.environ.get("ENVIRONMENT", "dev")
    if environment in ("production", "staging"):
        return ProductionSettings()
    return DevSettings()
