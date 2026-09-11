#!/usr/bin/env python3
# ============================================================
# nodum — CLI for managing a local Nodum Docker Compose stack
# ============================================================
#
# Install (from the `back/` directory):
#   pip install -e .        # editable (dev workflow)
#   pip install .             # from a built wheel / source tarball
#
# After install, the `nodum` command is on PATH. Usage:
#
#   nodum start              # dev stack (postgres + redis + minio + api + web)
#   nodum start --env prod   # production stack (needs deploy/.env.prod)
#   nodum stop               # stop containers (keep volumes)
#   nodum restart            # restart the current stack
#   nodum status             # state of every running container
#   nodum logs [-f] [service]  # tail logs (e.g. nodum logs -f api)
#   nodum exec <service> <cmd>  # run a command inside a service container
#   nodum migrate            # run Alembic migrations (one-shot, staging/prod only)
#   nodum clean              # stop + prune volumes (DESTRUCTIVE -- prompts first)
#   nodum help               # this screen
#
# Environment files:
#   dev    -> deploy/.env.dev  | deploy/.env
#   test   -> deploy/.env.test | deploy/.env
#   staging-> deploy/.env.staging  (required -- copy deploy/.env.staging.example)
#   prod   -> deploy/.env.prod    (required -- copy deploy/.env.prod.example)
#
# The CLI resolves deploy/ relative to the project root. By default it looks
# for a .git directory walking up from CWD; pass --root /path/to/nodum to
# override (useful when installed globally but invoked from elsewhere).
# ============================================================

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Project root discovery
# ---------------------------------------------------------------------------

GIT_MARKER = ".git"


def find_project_root(start: Path) -> Path:
    """Walk up from *start* until we find a .git directory or hit /."""
    current = start.resolve()
    root = Path("/")
    while current != root:
        if (current / GIT_MARKER).exists():
            return current
        current = current.parent
    return start.resolve()  # fallback: resolved start


def resolve_deploy_dir(root: Path) -> Path:
    """Return the path to deploy/ inside *root*, or exit with a helpful
    message if the layout doesn't look like a nodum checkout."""
    deploy = root / "deploy"
    if not deploy.is_dir():
        sys.exit(
            f"Error: {deploy} not found.\n"
            "  The CLI expects to run from inside a nodum checkout "
            "(the directory containing deploy/ and .git).\n"
            f"  Current/root: {root}\n"
            "  Pass --root /path/to/nodum to override."
        )
    compose_script = deploy / "compose.sh"
    if not compose_script.is_file():
        sys.exit(
            f"Error: {compose_script} not found.\n"
            "  This doesn't look like a nodum checkout "
            "(deploy/compose.sh is missing)."
        )
    return deploy


# ---------------------------------------------------------------------------
# Compose invocation
# ---------------------------------------------------------------------------


def compose(env: str, deploy_dir: Path, args: list[str]) -> int:
    """Run compose.sh env args... and return the exit code."""
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


# ---------------------------------------------------------------------------
# Compose args -- thin wrappers for the verbs the CLI exposes
# ---------------------------------------------------------------------------


def cmd_start(env: str, deploy_dir: Path, build: bool) -> int:
    args = ["up", "-d"]
    if build:
        args.append("--build")
    return compose(env, deploy_dir, args)


def cmd_stop(env: str, deploy_dir: Path) -> int:
    return compose(env, deploy_dir, ["down"])


def cmd_restart(env: str, deploy_dir: Path, build: bool) -> int:
    args = ["up", "-d"]
    if build:
        args.append("--build")
    return compose(env, deploy_dir, args)


def cmd_status(env: str, deploy_dir: Path) -> int:
    return compose(env, deploy_dir, ["ps"])


def cmd_logs(env: str, deploy_dir: Path, follow: bool, service: str | None) -> int:
    args = ["logs"]
    if follow:
        args.append("-f")
    if service:
        args.append(service)
    return compose(env, deploy_dir, args)


def cmd_exec(env: str, deploy_dir: Path, service: str, cmd_args: list[str]) -> int:
    return compose(env, deploy_dir, ["exec", service, *cmd_args])


def cmd_migrate(env: str, deploy_dir: Path) -> int:
    if env not in ("staging", "prod"):
        print(
            f"Error: `nodum migrate` is only supported on staging/prod.\n"
            f"  The {env!r} compose file has no `migrate` service.\n"
            f"  For dev/test, migrations run automatically on `nodum start`\n"
            f"  (see back/scripts/pre-start.sh). To re-run by hand:\n"
            f"    nodum exec api uv run alembic upgrade head\n"
            f"  or target staging/prod:\n"
            f"    nodum migrate --env staging",
            file=sys.stderr,
        )
        return 2
    return compose(env, deploy_dir, ["run", "--rm", "migrate"])


def cmd_clean(env: str, deploy_dir: Path, force: bool) -> int:
    if not force:
        if not sys.stdin.isatty():
            print(
                "Error: refusing to run destructively without a tty; pass --force.",
                file=sys.stderr,
            )
            return 1
        confirm = input(
            f"Clean removes the {env} stack AND ALL ITS VOLUMES"
            " (DB data, uploaded files, etc.). "
            f"Type {env!r} to confirm: "
        )
        if confirm.strip().lower() != env:
            print("Aborted.", file=sys.stderr)
            return 1
    return compose(env, deploy_dir, ["down", "-v"])


# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

ENV_CHOICES = ["dev", "test", "staging", "prod"]
DEFAULT_ENV = "dev"


def build_parser() -> argparse.ArgumentParser:
    """Build the full argument parser.

    ``--env`` and ``-r``/``--root`` are registered on a shared ``parents``
    parser attached to both the top-level parser and every subparser so they're
    available before or after the subcommand.  The top-level default for
    ``--env`` is ``dev``; subparsers inherit it.  ``main()`` pre-scans argv
    and overrides the parsed value so ``nodum --env prod start`` honours
    ``prod`` rather than the subparser's default.
    """
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "-r",
        "--root",
        type=Path,
        default=None,
        help="Path to the nodum checkout (auto-detected from CWD by default).",
    )
    common.add_argument(
        "--env",
        choices=ENV_CHOICES,
        default=DEFAULT_ENV,
        help=f"Which compose environment to target (default: {DEFAULT_ENV}).",
    )

    p = argparse.ArgumentParser(
        prog="nodum",
        description=(
            "Manage a local Nodum Docker Compose stack. "
            "Start: `nodum start`, Status: `nodum status`, Stop: `nodum stop`."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        parents=[common],
        epilog="""
Examples
  nodum start                     start the dev stack
  nodum start --env prod          start production (needs deploy/.env.prod)
  nodum --env prod start          same, alternate order
  nodum stop                      stop all containers
  nodum restart                   restart (no rebuild by default)
  nodum restart --build           restart with image rebuild
  nodum status                    container states
  nodum logs -f api               follow API logs
  nodum logs web                  web container logs
  nodum exec api python -m alembic revision --autogenerate -m "foo"
  nodum migrate --env staging     run migrations on staging
  nodum clean                     stop + remove all volumes (DESTRUCTIVE)
  nodum clean --force             same, no prompt
  nodum -r /opt/nodum start       use a specific checkout
""",
    )

    sub = p.add_subparsers(dest="command", required=True)

    start_p = sub.add_parser(
        "start",
        help="Start the stack (create + start containers).",
        parents=[common],
    )
    start_p.add_argument(
        "--no-build",
        action="store_true",
        help="Skip `docker compose build` (reuse existing images).",
    )

    sub.add_parser("stop", help="Stop and remove containers (volumes kept).", parents=[common])
    restart_p = sub.add_parser(
        "restart", help="Restart running containers (rebuilds if images changed).", parents=[common]
    )
    restart_p.add_argument(
        "--build",
        action="store_true",
        help="Rebuild images before starting.",
    )
    sub.add_parser("status", help="Show container states.", parents=[common])

    logs_p = sub.add_parser("logs", help="View container logs.", parents=[common])
    logs_p.add_argument("-f", "--follow", action="store_true", help="Follow log output.")
    logs_p.add_argument("service", nargs="?", default=None, help="Target service (api, web, caddy, ...).")

    exec_p = sub.add_parser("exec", help="Run a command inside a service container.", parents=[common])
    exec_p.add_argument("service", help="Service name (api, web, caddy, postgres, ...).")
    exec_p.add_argument("cmd", nargs=argparse.REMAINDER, help="Command to run inside the container.")

    sub.add_parser("migrate", help="Run Alembic migrations (one-shot, staging/prod only).", parents=[common])

    clean_p = sub.add_parser(
        "clean",
        help="Stop the stack AND remove all volumes -- DESTRUCTIVE.",
        parents=[common],
    )
    clean_p.add_argument("--force", action="store_true", help="Skip the confirmation prompt.")

    return p


def _shift_globals_before_command(argv: list[str] | None) -> list[str]:
    """Move ``--env``/``--root``/``-r`` tokens to just after the subcommand
    so argparse's subparser sees them in the standard position.

    ``nodum --env prod start`` becomes ``nodum start --env prod`` internally,
    which sidesteps argparse's quirk where a subparser default overwrites a
    top-level default for flags that appear before the subcommand name.

    ALL non-subcommand tokens before the subcommand (globals and subcommand-
    specific flags alike) are deferred to after it so the subparser — not the
    top-level parser — sees them::

        nodum --env prod --no-build start  ->  nodum start --env prod --no-build
    """
    if argv is None:
        argv = sys.argv[1:]
    argv = list(argv)
    before_cmd: list[str] = []
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok in _SUB_COMMANDS:
            # Found the subcommand: emit it first, then everything that came
            # before it (globals + subcommand-specific flags), then the rest.
            out: list[str] = [tok]
            out.extend(before_cmd)
            out.extend(argv[i + 1 :])
            return out
        before_cmd.append(tok)
        i += 1
    # No subcommand found: return as-is (argparse will fail with a clear
    # "missing command" error on its own).
    return argv


    _SUB_COMMANDS = frozenset(sub.choices)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    cleaned = _shift_globals_before_command(argv)
    args = parser.parse_args(cleaned)

    root = args.root or find_project_root(Path.cwd())
    env = args.env

    deploy_dir = resolve_deploy_dir(root)

    match args.command:
        case "start":
            return cmd_start(env, deploy_dir, not args.no_build)
        case "stop":
            return cmd_stop(env, deploy_dir)
        case "restart":
            return cmd_restart(env, deploy_dir, args.build)
        case "status":
            return cmd_status(env, deploy_dir)
        case "logs":
            return cmd_logs(env, deploy_dir, args.follow, args.service)
        case "exec":
            if not args.cmd:
                print(
                    "Error: no command given.\n  Usage: nodum exec <service> <cmd...>",
                    file=sys.stderr,
                )
                return 2
            return cmd_exec(env, deploy_dir, args.service, args.cmd)
        case "migrate":
            return cmd_migrate(env, deploy_dir)
        case "clean":
            return cmd_clean(env, deploy_dir, args.force)
        case _:
            parser.print_help()
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
