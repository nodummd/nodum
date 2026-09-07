#!/usr/bin/env python3
# ============================================================
# nodum — CLI for managing a local Nodum Docker Compose stack
# ============================================================
#
# Install (from the repo root):
#   pip install -e .        # editable (dev workflow)
#   pip install .            # from a built wheel / source tarball
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
#   nodum migrate            # run Alembic migrations (one-shot, normally automatic)
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
    return start  # fallback: the directory we started in


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
# Engine detection
# ---------------------------------------------------------------------------


def detect_engine() -> list[str]:
    """Return the compose command prefix: [docker, compose] or [podman, compose]."""
    if shutil_which("podman"):
        return ["podman", "compose"]
    if shutil_which("docker"):
        return ["docker", "compose"]
    sys.exit(
        "Error: neither `docker` nor `podman` found on PATH.\n"
        "  Install Docker Desktop / Docker Engine, or Podman, "
        "then try again."
    )


def shutil_which(name: str) -> bool:
    """Portable which -- returns True if *name* is on PATH."""
    try:
        return (
            subprocess.run(
                ["which", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode
            == 0
        )
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Compose invocation
# ---------------------------------------------------------------------------


def compose(env: str, deploy_dir: Path, args: list[str]) -> int:
    """Run compose.sh env args... and return the exit code."""
    script = deploy_dir / "compose.sh"
    # compose.sh is bash + set -euo pipefail; forward its own exit code.
    try:
        result = subprocess.run(
            [str(script), env, *args],
            cwd=str(deploy_dir),
            check=False,
        )
        return result.returncode
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


def cmd_restart(env: str, deploy_dir: Path) -> int:
    # down then up is safer than `compose restart` when images may have changed.
    code = compose(env, deploy_dir, ["down"])
    if code != 0:
        return code
    return compose(env, deploy_dir, ["up", "-d", "--build"])


def cmd_status(env: str, deploy_dir: Path) -> int:
    code = compose(env, deploy_dir, ["ps"])
    if code != 0:
        print(
            "Stack is not running.\n"
            f"  Start it:  nodum start --env {env}\n"
            "  Switch env: nodum start --env dev     # "
            "use a different environment file",
            file=sys.stderr,
        )
    return code


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
    # The migrate container is a one-shot in compose; bringing it up runs
    # the migration and exits. In the compose model this is normally wired
    # so every service waits on it, but the explicit verb is useful when
    # you need to re-run after a migration edit.
    return compose(env, deploy_dir, ["up", "migrate"])


def cmd_clean(env: str, deploy_dir: Path, force: bool) -> int:
    if not force:
        confirm = input(
            "Clean removes the stack AND all volumes (DB data, uploaded files, etc.). Type 'yes' to confirm: "
        )
        if confirm.strip().lower() != "yes":
            print("Aborted.", file=sys.stderr)
            return 1
    return compose(env, deploy_dir, ["down", "-v"])


# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

ENV_CHOICES = ["dev", "test", "staging", "prod"]
DEFAULT_ENV = "dev"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="nodum",
        description=(
            "Manage a local Nodum Docker Compose stack. "
            "Start: `nodum start`, Status: `nodum status`, Stop: `nodum stop`."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
  nodum start                     start the dev stack
  nodum start --env prod          start production (needs deploy/.env.prod)
  nodum stop                      stop all containers
  nodum restart                   restart (rebuilds if images changed)
  nodum status                    container states
  nodum logs -f api               follow API logs
  nodum logs web                  web container logs
  nodum exec api python -m alembic revision --autogenerate -m "foo"
  nodum migrate                   run Alembic migrations manually
  nodum clean                     stop + remove all volumes (DESTRUCTIVE)
  nodum clean --force             same, no prompt
  nodum -r /opt/nodum start       use a specific checkout
""",
    )

    p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Path to the nodum checkout (auto-detected from CWD by default).",
    )
    p.add_argument(
        "--env",
        choices=ENV_CHOICES,
        default=DEFAULT_ENV,
        help=f"Which compose environment to target (default: {DEFAULT_ENV}).",
    )

    sub = p.add_subparsers(dest="command", required=True)

    start_p = sub.add_parser("start", help="Start the stack (create + start containers).")
    start_p.add_argument(
        "--no-build",
        action="store_true",
        help="Skip `docker compose build` (reuse existing images).",
    )
    sub.add_parser("stop", help="Stop and remove containers (volumes kept).")
    sub.add_parser("restart", help="Stop then start (rebuilds if images changed).")
    sub.add_parser("status", help="Show container states.")

    logs_p = sub.add_parser("logs", help="View container logs.")
    logs_p.add_argument("-f", "--follow", action="store_true", help="Follow log output.")
    logs_p.add_argument("service", nargs="?", default=None, help="Target service (api, web, caddy, ...).")

    exec_p = sub.add_parser("exec", help="Run a command inside a service container.")
    exec_p.add_argument("service", help="Service name (api, web, caddy, postgres, ...).")
    exec_p.add_argument("cmd", nargs=argparse.REMAINDER, help="Command to run inside the container.")

    sub.add_parser("migrate", help="Run Alembic migrations (one-shot).")
    clean_p = sub.add_parser(
        "clean",
        help="Stop the stack AND remove all volumes -- DESTRUCTIVE.",
    )
    clean_p.add_argument("-f", "--force", action="store_true", help="Skip the confirmation prompt.")

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    # Root: explicit > walk up from CWD > CWD itself (most likely wrong, but
    # we let resolve_deploy_dir give a clear error).
    root = args.root if args.root is not None else find_project_root(Path.cwd())

    deploy_dir = resolve_deploy_dir(root)
    env = args.env

    # Dispatch.
    match args.command:
        case "start":
            return cmd_start(env, deploy_dir, not args.no_build)
        case "stop":
            return cmd_stop(env, deploy_dir)
        case "restart":
            return cmd_restart(env, deploy_dir)
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
