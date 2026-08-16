"""Encryption for stored AI provider keys.

These run with no infrastructure: the key comes from settings, which is
lru_cached, so every test that changes it clears the cache first.
"""

import pytest
from cryptography.fernet import Fernet

from app.settings import get_settings
from app.utils import crypto_utils


@pytest.fixture(autouse=True)
def _key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_round_trip():
    blob = crypto_utils.encrypt_secret("sk-ant-secret-value")
    assert blob.startswith("v1:")
    assert "sk-ant-secret-value" not in blob  # the point of the exercise
    assert crypto_utils.decrypt_secret(blob) == "sk-ant-secret-value"


def test_ciphertext_differs_each_time():
    a = crypto_utils.encrypt_secret("same")
    b = crypto_utils.encrypt_secret("same")
    assert a != b  # Fernet embeds a random IV — equal keys must not look equal
    assert crypto_utils.decrypt_secret(a) == crypto_utils.decrypt_secret(b) == "same"


def test_tampered_ciphertext_is_rejected():
    blob = crypto_utils.encrypt_secret("sk-openai-abc")
    tampered = blob[:-4] + ("aaaa" if not blob.endswith("aaaa") else "bbbb")
    assert crypto_utils.decrypt_secret(tampered) is None


def test_unknown_version_is_rejected():
    blob = crypto_utils.encrypt_secret("sk-openai-abc")
    assert crypto_utils.decrypt_secret(blob.replace("v1:", "v9:", 1)) is None
    assert crypto_utils.decrypt_secret("no-version-prefix") is None
    assert crypto_utils.decrypt_secret("") is None


def test_a_different_key_cannot_read_it(monkeypatch: pytest.MonkeyPatch):
    blob = crypto_utils.encrypt_secret("sk-gemini-xyz")
    monkeypatch.setenv("AI_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    assert crypto_utils.decrypt_secret(blob) is None


def test_passphrase_key_is_stretched(monkeypatch: pytest.MonkeyPatch):
    """An operator who sets a plain passphrase gets a working key, not a crash."""
    monkeypatch.setenv("AI_ENCRYPTION_KEY", "a-long-hand-written-passphrase-value")
    get_settings.cache_clear()
    assert crypto_utils.decrypt_secret(crypto_utils.encrypt_secret("k")) == "k"


def test_missing_key_disables_the_feature(monkeypatch: pytest.MonkeyPatch):
    # Not via the environment: `env_ignore_empty` means an empty env var falls
    # through to whatever .env holds, so a developer with a local key set would
    # see this test pass for the wrong reason.
    monkeypatch.setattr(get_settings(), "AI_ENCRYPTION_KEY", "")
    assert crypto_utils.encryption_available() is False
    with pytest.raises(crypto_utils.MissingEncryptionKey):
        crypto_utils.encrypt_secret("anything")


def test_mask_reveals_neither_end_of_a_short_key():
    assert crypto_utils.mask_secret("short") == "•••••"
    assert crypto_utils.mask_secret("sk-ant-api03-longvalue7f2a") == "sk-ant…7f2a"
