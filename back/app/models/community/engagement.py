"""Community engagement: likes, read markers, reports."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CommunityPostLike(Base):
    """One user's like on one post (composite PK, no surrogate id)."""

    __tablename__ = "community_post_likes"

    post_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("community_posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_community_post_likes_user", "user_id"),)


class CommunityTopicRead(Base):
    """How far a user has read a topic — unread is computed, never stored.

    ``last_read_post_number`` only ever moves forward (upserts take
    GREATEST), so a stale beacon can never resurrect an unread badge.
    """

    __tablename__ = "community_topic_reads"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    topic_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("community_topics.id", ondelete="CASCADE"), primary_key=True
    )
    last_read_post_number: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CommunityReport(UUIDMixin, TimestampMixin, Base):
    """A user flagging a post for staff. One report per reporter per post."""

    __tablename__ = "community_reports"

    post_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("community_posts.id", ondelete="CASCADE"), nullable=False
    )
    reporter_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="open", default="open")
    resolved_by_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("post_id", "reporter_id", name="uq_community_reports_post_reporter"),
        Index("ix_community_reports_status", "status", "created_at"),
    )
