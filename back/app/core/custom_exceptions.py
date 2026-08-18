"""Application exception hierarchy.

Every exception carries a stable machine-readable ``code`` used in the
error response envelope: {"error": {"code": ..., "message": ...}}.
"""

from typing import Any


class NodumError(Exception):
    """Base application error."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str = "", *, details: dict[str, Any] | None = None, code: str | None = None) -> None:
        self.message = message or self.__class__.__doc__ or "Error"
        self.details = details or {}
        # A family of related failures can share a status (and a class) while
        # keeping distinct codes in the envelope — "code_expired" and
        # "invalid_code" are both 422, but a client may want to tell them apart.
        if code:
            self.code = code
        super().__init__(self.message)


class NotFoundError(NodumError):
    """Resource not found."""

    status_code = 404
    code = "not_found"


class AlreadyExistsError(NodumError):
    """Resource already exists."""

    status_code = 409
    code = "already_exists"


class ValidationFailedError(NodumError):
    """Request failed domain validation."""

    status_code = 422
    code = "validation_failed"


class UnauthorizedError(NodumError):
    """Authentication required or invalid credentials."""

    status_code = 401
    code = "unauthorized"


class ForbiddenError(NodumError):
    """Authenticated but not allowed."""

    status_code = 403
    code = "forbidden"


class RateLimitedError(NodumError):
    """Too many requests."""

    status_code = 429
    code = "rate_limited"


class ConflictError(NodumError):
    """Concurrent modification conflict (stale note save)."""

    status_code = 409
    code = "conflict"


class EmailNotVerifiedError(NodumError):
    """The account exists but its email address has not been confirmed."""

    status_code = 403
    code = "email_not_verified"


class VerificationCodeError(NodumError):
    """The submitted verification code was wrong, expired, or exhausted."""

    status_code = 422
    code = "invalid_code"


class EmailDeliveryError(NodumError):
    """Every configured email provider refused the message."""

    status_code = 502
    code = "email_delivery_failed"
