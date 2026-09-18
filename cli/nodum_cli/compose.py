"""Single subprocess boundary: invoke ``deploy/compose.sh``."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ComposeResult = int


def compose(env: str, deploy_dir: Path, args: list[str]) -> ComposeResult:
    """Run ``compose.sh env args...`` and return the exit code.

    ``args`` must not include *env* — it is passed as the first positional
    argument to compose.sh.
    """
    script = deploy_dir / "compose.sh"
    try:
        result = subprocess.run(
            [str(script), env, *args],
            cwd=str(deploy_dir),
            check=False,
        )
        return result.returncode
    except OSError as exc:
        print(f"Error: cannot run {script}: {exc}", file=sys.stderr)
        return 127
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        return 130
