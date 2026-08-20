"""Pure logic behind the public API: scope defaulting/validation and the
wikilink removal that powers unlink."""

from app.constants.scopes import API_SCOPES
from app.services.api_token_service import effective_scopes, normalize_scopes
from app.utils.markdown_parse import remove_wikilinks


class TestScopes:
    def test_mcp_empty_means_everything(self) -> None:
        assert effective_scopes("mcp", []) == API_SCOPES
        assert effective_scopes("mcp", None) == API_SCOPES

    def test_key_empty_means_nothing(self) -> None:
        assert effective_scopes("key", []) == frozenset()
        assert effective_scopes("key", None) == frozenset()

    def test_explicit_scopes_pass_through(self) -> None:
        assert effective_scopes("key", ["read", "ai"]) == {"read", "ai"}
        assert effective_scopes("mcp", ["read"]) == {"read"}, "an explicitly scoped mcp row stays scoped"

    def test_normalize_orders_and_dedupes(self) -> None:
        assert normalize_scopes(["WRITE", "read", "read", " ai "]) == ["read", "write", "ai"]
        assert normalize_scopes(["read", "write", "delete", "ai"]) == ["read", "write", "delete", "ai"]

    def test_normalize_rejects_unknown_and_empty(self) -> None:
        assert normalize_scopes([]) is None
        assert normalize_scopes(None) is None
        assert normalize_scopes(["admin"]) is None
        assert normalize_scopes(["read", "root"]) is None
        assert normalize_scopes(["", "  "]) is None


class TestRemoveWikilinks:
    def test_removes_by_title_path_and_alias_case_insensitively(self) -> None:
        md = "A [[Alpha]] B [[sub/alpha]] C [[ALPHA|shown]] D [[Alpha#Heading]] E [[Zed]]"
        out, n = remove_wikilinks(md, {"alpha", "sub/alpha"})
        assert n == 4
        assert "[[Zed]]" in out and "Alpha" not in out

    def test_embeds_survive(self) -> None:
        md = "Text ![[Alpha]] and [[Alpha]]."
        out, n = remove_wikilinks(md, {"Alpha"})
        assert n == 1
        assert "![[Alpha]]" in out and out.count("[[Alpha]]") == 1

    def test_code_and_frontmatter_are_protected(self) -> None:
        md = (
            '---\nrelated: "[[Alpha]]"\n---\n'
            "Keep `[[Alpha]]` inline.\n"
            "```\n[[Alpha]] in a fence\n```\n"
            "~~~\n[[Alpha]] in a tilde fence\n~~~\n"
            "Remove [[Alpha]] here.\n"
        )
        out, n = remove_wikilinks(md, {"alpha"})
        assert n == 1
        assert out.count("[[Alpha]]") == 4, "frontmatter, inline code and both fences keep theirs"
        assert "Remove  here." in out

    def test_bullet_line_holding_only_the_link_is_dropped(self) -> None:
        md = "Intro\n\n- [[Alpha]]\n- [[Beta]]\n"
        out, n = remove_wikilinks(md, {"alpha"})
        assert n == 1
        assert out == "Intro\n\n- [[Beta]]\n"

    def test_no_match_returns_input_unchanged(self) -> None:
        md = "Nothing [[Here]] matches."
        assert remove_wikilinks(md, {"alpha"}) == (md, 0)
        assert remove_wikilinks(md, set()) == (md, 0)

    def test_unterminated_fence_swallows_the_rest(self) -> None:
        md = "[[Alpha]]\n```\n[[Alpha]] forever unclosed\n"
        out, n = remove_wikilinks(md, {"alpha"})
        assert n == 1 and "forever unclosed" in out
