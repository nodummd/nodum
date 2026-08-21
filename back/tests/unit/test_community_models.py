"""Community S1.1 pure logic: slugs and model constraint names."""

from app.models.community import (
    CommunityCategory,
    CommunityPost,
    CommunityPostLike,
    CommunityReport,
    CommunityTopic,
    CommunityTopicRead,
)
from app.utils.slug_utils import slugify


class TestSlugify:
    def test_basic(self) -> None:
        assert slugify("Hello, World!") == "hello-world"
        assert slugify("How do I sync two vaults?") == "how-do-i-sync-two-vaults"

    def test_never_empty(self) -> None:
        assert slugify("") == "topic"
        assert slugify("???") == "topic"
        assert slugify("---") == "topic"

    def test_unicode_decomposes_not_dashes(self) -> None:
        assert slugify("Ünïcode Tïtle") == "unicode-title"
        assert slugify("café notes") == "cafe-notes"

    def test_length_capped(self) -> None:
        assert len(slugify("word " * 100)) <= 100

    def test_collapses_runs(self) -> None:
        assert slugify("a  --  b") == "a-b"


class TestModelShape:
    def test_constraint_names_are_stable(self) -> None:
        """Migrations and ON CONFLICT clauses name these — renames break them."""
        assert any(c.name == "uq_community_categories_slug" for c in CommunityCategory.__table__.constraints)
        assert any(c.name == "uq_community_posts_topic_number" for c in CommunityPost.__table__.constraints)
        assert any(c.name == "uq_community_reports_post_reporter" for c in CommunityReport.__table__.constraints)

    def test_author_links_survive_account_deletion(self) -> None:
        for table, col in (
            (CommunityTopic.__table__, "author_id"),
            (CommunityPost.__table__, "author_id"),
            (CommunityReport.__table__, "reporter_id"),
        ):
            fk = next(iter(table.columns[col].foreign_keys))
            assert fk.ondelete == "SET NULL", f"{table.name}.{col} must not cascade"

    def test_engagement_rows_die_with_their_user(self) -> None:
        for table in (CommunityPostLike.__table__, CommunityTopicRead.__table__):
            fk = next(iter(table.columns["user_id"].foreign_keys))
            assert fk.ondelete == "CASCADE"

    def test_counters_start_correctly(self) -> None:
        t = CommunityTopic.__table__
        assert t.columns["reply_count"].server_default.arg == "0", "reply_count excludes the OP"
        assert t.columns["last_post_number"].server_default.arg == "1", "the OP is post 1"
