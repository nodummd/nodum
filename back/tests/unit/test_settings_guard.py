"""Production must refuse to boot on any credential that ships in the repo.

The guard used to cover SECRET_KEY/JWT_SECRET_KEY only, so an operator who
followed "copy .env.example, fix what it complains about" got a production
stack running on minioadmin:minioadmin and nodum:nodum — both published.
"""

import pytest

from app.settings.production import ProductionSettings

_GOOD = {
    "SECRET_KEY": "a" * 40,
    "JWT_SECRET_KEY": "b" * 40,
    "POSTGRES_PASSWORD": "a-real-postgres-password",
    "S3_SECRET_KEY": "a-real-minio-password",
}


def test_accepts_real_credentials() -> None:
    assert ProductionSettings(**_GOOD).POSTGRES_PASSWORD == "a-real-postgres-password"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("POSTGRES_PASSWORD", "nodum"),
        ("POSTGRES_PASSWORD", "postgres"),
        ("POSTGRES_PASSWORD", "short"),
        ("S3_SECRET_KEY", "minioadmin"),
        ("S3_SECRET_KEY", "admin"),
        ("SECRET_KEY", "change-me-in-production-this-default-is-not-a-secret"),
        ("JWT_SECRET_KEY", "too-short"),
    ],
)
def test_rejects_defaults_and_short_values(field: str, value: str) -> None:
    with pytest.raises(ValueError):
        ProductionSettings(**{**_GOOD, field: value})


def test_the_error_names_the_env_var_the_operator_edits() -> None:
    """Compose maps MINIO_ROOT_PASSWORD -> S3_SECRET_KEY; naming the setting
    would send them to a line that does not exist in their .env."""
    with pytest.raises(ValueError, match="MINIO_ROOT_PASSWORD"):
        ProductionSettings(**{**_GOOD, "S3_SECRET_KEY": "minioadmin"})
