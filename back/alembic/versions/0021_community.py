"""community: categories/topics/posts/likes/reads/reports + users.is_staff

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_staff", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "community_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_staff_only_posting", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("topic_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("post_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_community_categories_slug"),
    )

    op.create_table(
        "community_topics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("slug", sa.String(length=300), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_post_number", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_post_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "last_post_author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "title_tsv",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('english', coalesce(title, ''))", persisted=True),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_community_topics_category_lists", "community_topics", ["category_id", "is_pinned", "last_post_at"]
    )
    op.create_index("ix_community_topics_last_post_at", "community_topics", ["last_post_at"])
    op.create_index("ix_community_topics_author", "community_topics", ["author_id"])
    op.create_index("ix_community_topics_title_tsv", "community_topics", ["title_tsv"], postgresql_using="gin")

    op.create_table(
        "community_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "topic_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_topics.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("post_number", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "content_tsv",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('english', coalesce(content, ''))", persisted=True),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("topic_id", "post_number", name="uq_community_posts_topic_number"),
    )
    op.create_index("ix_community_posts_author", "community_posts", ["author_id"])
    op.create_index("ix_community_posts_content_tsv", "community_posts", ["content_tsv"], postgresql_using="gin")

    op.create_table(
        "community_post_likes",
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_posts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_community_post_likes_user", "community_post_likes", ["user_id"])

    op.create_table(
        "community_topic_reads",
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "topic_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_topics.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("last_read_post_number", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "community_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("reason", sa.String(length=50), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'open'")),
        sa.Column(
            "resolved_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("post_id", "reporter_id", name="uq_community_reports_post_reporter"),
    )
    op.create_index("ix_community_reports_status", "community_reports", ["status", "created_at"])

    # Seed the five fixed categories (id via gen_random_uuid(): pgcrypto is in
    # the base image; ordering comes from position, identity from the slug).
    op.execute(
        """
        INSERT INTO community_categories (id, name, slug, description, position, is_staff_only_posting)
        VALUES
          (gen_random_uuid(), 'Announcements', 'announcements', 'News about Nodum itself — releases, changes, plans.', 0, true),
          (gen_random_uuid(), 'Help', 'help', 'Stuck on something? Ask here.', 1, false),
          (gen_random_uuid(), 'Bug Reports', 'bugs', 'Something broken or behaving oddly.', 2, false),
          (gen_random_uuid(), 'Feature Requests', 'features', 'What Nodum should learn to do — like posts to vote.', 3, false),
          (gen_random_uuid(), 'Showcase', 'showcase', 'Show how you use Nodum — vaults, workflows, integrations.', 4, false)
        ON CONFLICT ON CONSTRAINT uq_community_categories_slug DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("community_reports")
    op.drop_table("community_topic_reads")
    op.drop_table("community_post_likes")
    op.drop_table("community_posts")
    op.drop_table("community_topics")
    op.drop_table("community_categories")
    op.drop_column("users", "is_staff")
