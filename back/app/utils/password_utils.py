"""Password hashing with Argon2id.

Argon2id is deliberately expensive — that is the point — which makes it exactly
the wrong thing to run on the event loop. The library-recommended parameters
cost tens of milliseconds of solid CPU per call, and every one of those
milliseconds is time the worker cannot serve any other request: a burst of
logins stalls note saves, searches and health checks alike.

The sync functions stay for callers already off the loop (tests, scripts,
threads); async endpoints use the `_async` variants, which hand the work to a
thread.
"""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id with library-recommended parameters


def hash_password(password: str) -> str:
    """Hash a plaintext password. Blocking — prefer hash_password_async."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password. Blocking — prefer verify_password_async."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


async def hash_password_async(password: str) -> str:
    """Hash off the event loop, so signup does not stall the whole worker."""
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password: str, password_hash: str) -> bool:
    """Verify off the event loop, so login does not stall the whole worker."""
    return await asyncio.to_thread(verify_password, password, password_hash)


def needs_rehash(password_hash: str) -> bool:
    """True when the hash predates current parameters and should be upgraded."""
    return _hasher.check_needs_rehash(password_hash)
