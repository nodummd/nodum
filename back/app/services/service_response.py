"""ServiceResponse — uniform return type for the service layer.

Services never raise HTTP exceptions; they return a ServiceResponse and the
router translates failures via ``unwrap()`` (which maps the error code to an
app exception handled by the global handlers).
"""

from dataclasses import dataclass, field
from typing import Any

from app.core import custom_exceptions as exc

_CODE_TO_EXC: dict[str, type[exc.NodumError]] = {
    "not_found": exc.NotFoundError,
    "already_exists": exc.AlreadyExistsError,
    "validation_failed": exc.ValidationFailedError,
    "unauthorized": exc.UnauthorizedError,
    "forbidden": exc.ForbiddenError,
    "conflict": exc.ConflictError,
    "rate_limited": exc.RateLimitedError,
    "email_not_verified": exc.EmailNotVerifiedError,
    # One status, three codes the client can tell apart.
    "invalid_code": exc.VerificationCodeError,
    "code_expired": exc.VerificationCodeError,
    "too_many_attempts": exc.VerificationCodeError,
    "email_delivery_failed": exc.EmailDeliveryError,
}


@dataclass
class ServiceResponse[T]:
    """Result of a service call: either ``data`` on success or an error code."""

    success: bool
    data: T | None = None
    error_code: str = ""
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def ok(cls, data: T | None = None) -> "ServiceResponse[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error_code: str, message: str = "", **details: Any) -> "ServiceResponse[T]":
        return cls(success=False, error_code=error_code, message=message, details=details)

    def unwrap(self) -> T:
        """Return data on success; raise the mapped domain exception on failure."""
        if self.success:
            return self.data  # type: ignore[return-value]
        exc_cls = _CODE_TO_EXC.get(self.error_code, exc.NodumError)
        # Pass the service's own code through: for mapped codes it matches the
        # class's, and for families sharing a class it keeps them distinct.
        raise exc_cls(self.message, details=self.details or None, code=self.error_code)
