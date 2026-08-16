"""Reversible encryption for third-party secrets we must be able to use again.

Passwords are hashed (`password_utils`) and clipper tokens are hashed
(`clipper_service`) because neither ever needs to be read back. An AI provider
key is different: the server has to send the real key to Anthropic or OpenAI on
every call, so it must be recoverable — which makes this the first place in the
codebase that needs symmetric encryption at rest.

Fernet (AES-128-CBC + HMAC-SHA256, from `cryptography`) gives authenticated
encryption, so a tampered ciphertext fails loudly instead of decrypting to
garbage. The stored blob carries a version prefix: the key can be rotated later
by teaching `decrypt_secret` an older version rather than by an un-migratable
table rewrite.

The key comes from AI_ENCRYPTION_KEY, deliberately NOT from SECRET_KEY: that
setting is used by nothing today and an operator may reasonably rotate it, which
would silently destroy every stored credential.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.settings import get_settings

VERSION = "v1"


class MissingEncryptionKey(RuntimeError):
    """AI_ENCRYPTION_KEY is unset — refuse to store a secret in the clear."""


def _fernet() -> Fernet:
    """Build the cipher from the configured key.

    Accepts either a real 32-byte urlsafe-base64 Fernet key (what
    `Fernet.generate_key()` prints, and what operators should set) or any
    sufficiently long passphrase, which is stretched with SHA-256 so a
    hand-written value still produces a valid key rather than a crash.
    """
    raw = (get_settings().AI_ENCRYPTION_KEY or "").strip()
    if not raw:
        raise MissingEncryptionKey("AI_ENCRYPTION_KEY is not configured")
    try:
        return Fernet(raw.encode())
    except (ValueError, TypeError):
        derived = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
        return Fernet(derived)


def encryption_available() -> bool:
    """True when secrets can be stored — the settings UI asks before offering to."""
    try:
        _fernet()
    except (MissingEncryptionKey, ValueError, TypeError):
        return False
    return True


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret for storage. Returns `v1:<token>`."""
    if not plaintext:
        raise ValueError("refusing to encrypt an empty secret")
    return f"{VERSION}:{_fernet().encrypt(plaintext.encode()).decode()}"


def decrypt_secret(blob: str) -> str | None:
    """Recover a secret, or None if it is unreadable.

    None covers every failure the caller can do nothing about — an unknown
    version, a tampered or truncated token, a changed key. The caller reports
    "re-enter your key" rather than leaking which of those it was.
    """
    if not blob or ":" not in blob:
        return None
    version, _, token = blob.partition(":")
    if version != VERSION:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, MissingEncryptionKey, ValueError, TypeError):
        return None


def mask_secret(plaintext: str) -> str:
    """A hint that identifies a key without revealing it: `sk-ant…7f2a`."""
    if len(plaintext) <= 8:
        return "•" * len(plaintext)
    return f"{plaintext[:6]}…{plaintext[-4:]}"
