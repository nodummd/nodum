"""Project root discovery and deploy/ resolution.

Walks up from CWD looking for ``deploy/compose.sh``; the directory that
contains it is treated as the nodum checkout root. ``resolve_deploy_dir``
verifies that ``deploy/`` and ``deploy/compose.sh`` exist inside it.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_MARKER = "deploy/compose.sh"


def find_project_root(start: Path) -> Path:
    """Walk up from *start* until we find ``deploy/compose.sh`` or hit the
    filesystem root.

    Returns the resolved path of the directory containing deploy/compose.sh,
    or *start* resolved if the file isn't found before reaching the top of the
    filesystem.
    """
    current = start.resolve()
    while current != current.parent:
        if (current / ROOT_MARKER).exists():
            return current
        current = current.parent
    return start.resolve()


def resolve_deploy_dir(root: Path) -> Path:
    """Return ``root / deploy`` after verifying the nodum layout.

    Exits with a non-zero code and a message on stderr if the layout doesn't
    look like a nodum checkout.
    """
    deploy = root / "deploy"
    if not deploy.is_dir():
        sys.exit(
            f"Error: {deploy} not found.\n"
            "  The CLI expects to run from inside a nodum checkout "
            "(the directory containing deploy/ and deploy/compose.sh).\n"
            f"  Current/root: {root}\n"
            "  Pass --root /path/to/nodum to override."
        )
    compose_script = root / ROOT_MARKER
    if not compose_script.is_file():
        sys.exit(
            f"Error: {compose_script} not found.\n"
            "  This doesn't look like a nodum checkout "
            "(deploy/compose.sh is missing)."
        )
    return deploy
