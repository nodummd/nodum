"""Password hashing with Argon2id."""

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id with library-recommended parameters


def hash_password(password: str) -> str:
    """Hash a plaintext password."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored hash."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the hash predates current parameters and should be upgraded."""
    return _hasher.check_needs_rehash(password_hash)
