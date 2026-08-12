"""Control-plane Redis URL derivation."""

from app.core.redis import control_url_from


def test_derives_db3_from_db_suffixed_url() -> None:
    assert control_url_from("redis://redis:6379/0") == "redis://redis:6379/3"


def test_derives_db3_when_no_db_suffix() -> None:
    assert control_url_from("redis://localhost:6379") == "redis://localhost:6379/3"


def test_replaces_nonzero_cache_db() -> None:
    assert control_url_from("redis://host:6379/5") == "redis://host:6379/3"
