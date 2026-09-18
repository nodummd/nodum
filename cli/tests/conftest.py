"""Shared pytest fixtures and configuration for the nodum CLI test suite."""

from __future__ import annotations

from nodum_cli.main import main as _main


def main(argv: list[str] | None = None) -> None:
    """Call the CLI's ``main()`` and raise ``SystemExit`` with its return code.

    When *argv* is ``None`` the real ``sys.argv[1:]`` is used, so tests that
    want to exercise the "read sys.argv" path can call ``main()`` without args.
    """
    if argv is None:
        import sys

        argv = sys.argv[1:]
    raise SystemExit(_main(argv))
