"""Stack-level compose commands: up, down, restart, ps, logs, exec, migrate, reset, clean."""

from __future__ import annotations

import sys
from pathlib import Path

from nodum_cli.compose import compose

# ---------------------------------------------------------------------------
# Compose arg builders — each returns the argv tail (without env) for one verb
# ---------------------------------------------------------------------------


def stack_up(env: str, deploy_dir: Path, build: bool) -> int:
    args = ["up", "-d"]
    if build:
        args.append("--build")
    return compose(env, deploy_dir, args)


def stack_down(env: str, deploy_dir: Path, volumes: bool) -> int:
    args = ["down"]
    if volumes:
        args.append("-v")
    return compose(env, deploy_dir, args)


def stack_restart(env: str, deploy_dir: Path, build: bool) -> int:
    args = ["up", "-d", "--force-recreate"]
    if build:
        args.append("--build")
    return compose(env, deploy_dir, args)


def stack_ps(env: str, deploy_dir: Path) -> int:
    return compose(env, deploy_dir, ["ps"])


def stack_logs(env: str, deploy_dir: Path, follow: bool, service: str | None) -> int:
    args = ["logs"]
    if follow:
        args.append("-f")
    if service:
        args.append(service)
    return compose(env, deploy_dir, args)


def stack_exec(env: str, deploy_dir: Path, service: str, cmd_args: list[str]) -> int:
    return compose(env, deploy_dir, ["exec", service, *cmd_args])


def stack_migrate(env: str, deploy_dir: Path) -> int:
    if env not in ("staging", "prod"):
        print(
            f"Error: `nodum stack migrate` is only supported on staging/prod.\n"
            f"  The {env!r} compose file has no `migrate` service.\n"
            "  For dev/test, migrations run automatically on `nodum stack up` "
            "(see back/scripts/pre-start.sh). To re-run by hand:\n"
            "    nodum stack exec api uv run alembic upgrade head\n"
            "  or target staging/prod:\n"
            "    nodum stack migrate --env staging",
            file=sys.stderr,
        )
        return 2
    return compose(env, deploy_dir, ["run", "--rm", "migrate"])


def _clean_confirm(env: str, force: bool) -> int:
    """Shared destructive-guard logic used by ``stack_clean`` and ``stack_reset``."""
    if not force:
        if not sys.stdin.isatty():
            msg = "Error: refusing to run destructively without a tty" + (
                "; non-interactive destruction of staging/prod is not supported."
                if env in ("staging", "prod")
                else "; pass --force."
            )
            print(msg, file=sys.stderr)
            return 1
        try:
            confirm = input(
                f"Clean removes the {env} stack AND ALL ITS VOLUMES "
                "(DB data, uploaded files, etc.). "
                f"Type {env} to confirm: "
            )
        except EOFError:
            print("Aborted.", file=sys.stderr)
            return 1
        if confirm.strip().lower() != env:
            print("Aborted.", file=sys.stderr)
            return 1
    else:
        # --force: dev/test skip the prompt; staging/prod must still confirm.
        if env in ("staging", "prod"):
            if not sys.stdin.isatty():
                print(
                    f"Error: refusing to destroy {env} stack without a tty "
                    f"even with --force. Non-interactive destruction of staging/prod "
                    f"is not supported.",
                    file=sys.stderr,
                )
                return 1
            try:
                confirm = input(f"Final confirmation: type {env} to destroy the {env} stack and ALL volumes: ")
            except EOFError:
                print("Aborted.", file=sys.stderr)
                return 1
            if confirm.strip().lower() != env:
                print("Aborted.", file=sys.stderr)
                return 1
    return 0


def stack_clean(env: str, deploy_dir: Path, force: bool) -> int:
    rc = _clean_confirm(env, force)
    if rc != 0:
        return rc
    return compose(env, deploy_dir, ["down", "-v"])


def stack_reset(env: str, deploy_dir: Path, force: bool) -> int:
    rc = _clean_confirm(env, force)
    if rc != 0:
        return rc
    return compose(env, deploy_dir, ["down", "-v", "--remove-orphans"])
