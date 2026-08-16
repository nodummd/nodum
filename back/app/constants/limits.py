"""Application limits — single place to tune fair-use caps."""

MAX_VAULTS_PER_USER = 20
MAX_NOTE_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB of markdown per note
MAX_NOTES_PER_VAULT = 100_000
MAX_FOLDER_DEPTH = 20
MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB per attachment
MAX_IMPORT_ZIP_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB
# Hard ceiling on any request body, enforced from Content-Length before routing.
# FastAPI parses multipart (spooling to disk past ~1MB) *before* it resolves the
# auth dependency, so without this an unauthenticated caller can fill the
# container's disk. Sized above the import cap plus multipart overhead so it
# never bites a legitimate upload.
MAX_REQUEST_BODY_BYTES = MAX_IMPORT_ZIP_SIZE_BYTES + 16 * 1024 * 1024
MAX_TITLE_LENGTH = 255
MAX_PATH_LENGTH = 1024
NOTE_VERSIONS_KEPT = 50
# Minimum age of the newest snapshot before another is taken on save
NOTE_VERSION_INTERVAL_SECONDS = 300
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

# Payload caps — huge vaults degrade gracefully instead of shipping 20MB JSON;
# responses set "truncated": true when a cap bites
MAX_TREE_ITEMS = 20_000
MAX_GRAPH_NODES = 20_000
MAX_BACKLINK_SOURCES = 200
# Unlinked-mentions ILIKE scan budget — the pane degrades to empty on timeout
# (decision: no pg_trgm GIN; 2MB contents make it enormous + write-heavy)
UNLINKED_MENTIONS_TIMEOUT_MS = 2000
# Related-notes cosine scan budget. Same bargain as above: exact results,
# bounded time. Deliberately NOT an ANN index — the query filters on vault_id,
# and pgvector post-filters an HNSW index, so a table-wide one would return the
# globally-nearest rows and only then apply the tenant filter, handing back
# empty or wrong results on a multi-tenant table. An index here would have to
# be per-tenant (partitioning or partial indexes), which is a schema decision,
# not a tuning one.
RELATED_NOTES_TIMEOUT_MS = 2000
