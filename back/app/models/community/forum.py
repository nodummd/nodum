"""Community forum core: categories → topics → posts.

Platform-global (no vault scoping) and publicly readable, so every list the
UI needs is answerable from indexed columns: the denormalized counters here
are maintained transactionally by community_service, always as atomic
``SET x = x ± 1`` bumps under the topic row lock that post-number assignment
already takes — never read-modify-write.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, Computed, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CommunityCategory(UUIDMixin, TimestampMixin, Base):
    """A fixed, seeded posting area (Announcements, Help, …)."""

    __tablename__ = "community_categories"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    # Announcements: anyone reads, only staff starts topics.
    is_staff_only_posting: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    topic_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    post_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    __table_args__ = (UniqueConstraint("slug", name="uq_community_categories_slug"),)

    def __repr__(self) -> str:
        return f"<CommunityCategory {self.slug}>"


class CommunityTopic(UUIDMixin, TimestampMixin, Base):
    """A thread: title plus its chain of posts (the first post is the body)."""

    __tablename__ = "community_topics"

    category_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("community_categories.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL, not CASCADE: deleting an account must not vaporize public
    # discussions — the thread stays, attributed to a deleted user.
    author_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # Non-unique: URLs are id-first (/t/{id}/{slug}), so retitling never 404s.
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    # Replies (excludes the opening post); decremented on reply soft-delete.
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    # Monotonic post-number source — NEVER decremented, so numbers stay
    # stable across soft-deletes. The OP is post_number 1.
    last_post_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    last_post_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_post_author_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(title, ''))", persisted=True),
        nullable=True,
        deferred=True,
    )

    __table_args__ = (
        # The category page: pinned first, then freshest activity.
        Index("ix_community_topics_category_lists", "category_id", "is_pinned", "last_post_at"),
        Index("ix_community_topics_last_post_at", "last_post_at"),
        Index("ix_community_topics_author", "author_id"),
        Index("ix_community_topics_title_tsv", "title_tsv", postgresql_using="gin"),
    )

    def __repr__(self) -> str:
        return f"<CommunityTopic {self.title!r}>"


class CommunityPost(UUIDMixin, TimestampMixin, Base):
    """One markdown message in a topic. Raw markdown only — the backend
    never renders it; the web client renders with a sanctioned pipeline."""

    __tablename__ = "community_posts"

    topic_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("community_topics.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    post_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    like_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(content, ''))", persisted=True),
        nullable=True,
        deferred=True,
    )

    __table_args__ = (
        # Uniqueness AND the keyset-pagination index in one.
        UniqueConstraint("topic_id", "post_number", name="uq_community_posts_topic_number"),
        Index("ix_community_posts_author", "author_id"),
        Index("ix_community_posts_content_tsv", "content_tsv", postgresql_using="gin"),
    )

    def __repr__(self) -> str:
        return f"<CommunityPost #{self.post_number}>"
