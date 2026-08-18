"""Auth request/response schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    """Refresh token in the body — optional; the httpOnly cookie is preferred."""

    refresh_token: str | None = None


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class VerificationRequiredOut(BaseModel):
    """Signup's answer when the address has to be confirmed first — no tokens
    are issued until it is."""

    status: str = "verification_required"
    email: EmailStr
    expires_in_minutes: int


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    name: str
    avatar_url: str | None
    email_verified: bool
    settings: dict[str, Any]
    created_at: datetime


class TokenPairOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # access token lifetime in seconds
    user: UserOut


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar_url: str | None = None
    settings: dict[str, Any] | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
