"""Public-API key scopes — the single source of truth.

Coarse on purpose: they map one-to-one onto what the service layer can do,
and `ai` is separate so a read-only key can never spend the user's AI credit.
"""

# Canonical order — used when normalising a key's scope list for display.
SCOPE_ORDER: tuple[str, ...] = ("read", "write", "delete", "ai")

API_SCOPES: frozenset[str] = frozenset(SCOPE_ORDER)

SCOPE_DESCRIPTIONS: dict[str, str] = {
    "read": "List and read vaults, notes, links, tags, search and the graph.",
    "write": "Create and edit notes, links, tags and attachments.",
    "delete": "Delete notes and attachments.",
    "ai": "Ask the vault questions with the configured AI provider (can also write notes via AI tools).",
}
