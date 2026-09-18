"""Argument parsing and dispatch for ``nodum`` / ``nodum stack``.

The parser is built with ``argparse`` and supports two invocation styles::

    nodum stack --env prod up
    nodum stack up --env prod

``--env`` and ``-r``/``--root`` are registered on the top-level parser
and on each ``stack <verb>`` subparser via ``argparse.SUPPRESS`` so an
unspecified flag never overwrites the top-level value.  That means both
orderings resolve to the same namespace with no argv surgery.

All example lines in this docstring and in the ``stack`` subparser's
epilog are round-tripped in the parser tests (test_examples_parse).

Quick reference (all parse correctly)::

    nodum stack up                     start the dev stack
    nodum stack up --env prod            start production (needs deploy/.env.prod)
    nodum stack --env prod up           same, alternate order
    nodum stack --env staging up --no-build   staging, skip image rebuild
    nodum stack down                   stop all containers (keep volumes)
    nodum stack down -v                stop + remove volumes
    nodum stack restart                recreate all containers (no rebuild by default)
    nodum stack restart --build        recreate + rebuild images
    nodum stack reset                  clean + remove orphan containers
    nodum stack reset --env prod       reset production
    nodum stack ps                     container states
    nodum stack logs -f api            follow API logs
    nodum stack logs web               web container logs
    nodum stack exec api uv run alembic revision --autogenerate -m "foo"
    nodum stack migrate                 run migrations (staging/prod only)
    nodum stack migrate --env staging  run migrations on staging
    nodum stack clean                  stop + remove all volumes (DESTRUCTIVE)
    nodum stack clean --force          same, no prompt (dev/test only)
    nodum stack -r /opt/nodum up       use a specific checkout
    nodum --help                       this screen
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from nodum_cli.commands.stack import (
    stack_clean,
    stack_down,
    stack_exec,
    stack_logs,
    stack_migrate,
    stack_ps,
    stack_reset,
    stack_restart,
    stack_up,
)
from nodum_cli.project import find_project_root, resolve_deploy_dir

ENV_CHOICES = ["dev", "test", "staging", "prod"]
DEFAULT_ENV = "dev"

SUB_COMMANDS: frozenset[str] = frozenset(
    (
        "up",
        "down",
        "restart",
        "ps",
        "logs",
        "exec",
        "migrate",
        "clean",
        "reset",
    )
)


def _globals_parser(defaults: bool) -> argparse.ArgumentParser:
    """Parent parser for the global ``--env`` / ``-r`` / ``--root`` flags.

    When *defaults* is True the flags carry their real defaults (for the
    top-level parser).  When False they carry ``argparse.SUPPRESS`` so an
    unsupplied flag never lands in a subparser's namespace and the top-level
    value survives.
    """
    p = argparse.ArgumentParser(add_help=False)
    root_kwargs: dict = {}
    env_kwargs: dict = {}
    if not defaults:
        root_kwargs["default"] = argparse.SUPPRESS
        env_kwargs["default"] = argparse.SUPPRESS
    p.add_argument(
        "-r",
        "--root",
        type=lambda s: Path(s).expanduser().resolve(),
        **root_kwargs,
        help="Path to the nodum checkout (auto-detected from CWD by default).",
    )
    p.add_argument(
        "--env",
        choices=ENV_CHOICES,
        default=DEFAULT_ENV if defaults else argparse.SUPPRESS,
        help=f"Which compose environment to target (default: {DEFAULT_ENV}).",
    )
    return p


def _examples_block() -> str:
    """Hoisted example text used by both the top-level and ``stack`` epilogs."""
    return (
        "Examples\n"
        "  nodum stack up                     start the dev stack\n"
        "  nodum stack up --env prod          start production (needs deploy/.env.prod)\n"
        "  nodum stack --env prod up           same, alternate order\n"
        "  nodum stack --env staging up --no-build   staging, skip image rebuild\n"
        "  nodum stack down                   stop all containers (keep volumes)\n"
        "  nodum stack down -v                stop + remove volumes\n"
        "  nodum stack restart                recreate all containers (no rebuild by default)\n"
        "  nodum stack restart --build        recreate + rebuild images\n"
        "  nodum stack reset                  clean + remove orphan containers\n"
        "  nodum stack reset --env prod       reset production\n"
        "  nodum stack ps                     container states\n"
        "  nodum stack logs -f api            follow API logs\n"
        "  nodum stack logs web               web container logs\n"
        '  nodum stack exec api uv run alembic revision --autogenerate -m "foo"\n'
        "  nodum stack migrate                 run migrations (staging/prod only)\n"
        "  nodum stack migrate --env staging  run migrations on staging\n"
        "  nodum stack clean                  stop + remove all volumes (DESTRUCTIVE)\n"
        "  nodum stack clean --force          same, no prompt (dev/test only)\n"
        "  nodum stack -r /opt/nodum up       use a specific checkout\n"
        "  nodum --help                       this screen\n"
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the full ``nodum stack`` argument parser."""
    top_parents = _globals_parser(defaults=True)

    p = argparse.ArgumentParser(
        prog="nodum",
        description=(
            "Manage a local Nodum Docker Compose stack. "
            "Start: `nodum stack up`, Status: `nodum stack ps`, Stop: `nodum stack down`."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        parents=[top_parents],
        epilog=_examples_block(),
    )

    sub = p.add_subparsers(dest="command", required=True)

    # ── nodum stack ──────────────────────────────────────────────────────
    stack_p = sub.add_parser(
        "stack",
        help="Manage the Docker Compose stack.",
        parents=[_globals_parser(defaults=False)],
        description="Manage a local Nodum Docker Compose stack.",
        epilog=_examples_block(),
    )
    stack_sub = stack_p.add_subparsers(dest="stack_command", required=True)

    up_p = stack_sub.add_parser(
        "up",
        help="Start the stack (create + start containers).",
        parents=[_globals_parser(defaults=False)],
    )
    up_p.add_argument(
        "--no-build",
        action="store_true",
        help="Skip `docker compose build` (reuse existing images).",
    )

    down_p = stack_sub.add_parser(
        "down",
        help="Stop and remove containers (volumes kept unless -v).",
        parents=[_globals_parser(defaults=False)],
    )
    down_p.add_argument(
        "-v",
        "--volumes",
        action="store_true",
        help="Remove named volumes as well.",
    )

    restart_p = stack_sub.add_parser(
        "restart",
        help="Recreate running containers (optional rebuild).",
        parents=[_globals_parser(defaults=False)],
    )
    restart_p.add_argument(
        "--build",
        action="store_true",
        help="Rebuild images before restarting.",
    )

    stack_sub.add_parser(
        "ps",
        help="Show container states.",
        parents=[_globals_parser(defaults=False)],
    )

    logs_p = stack_sub.add_parser(
        "logs",
        help="View container logs.",
        parents=[_globals_parser(defaults=False)],
    )
    logs_p.add_argument("-f", "--follow", action="store_true", help="Follow log output.")
    logs_p.add_argument(
        "service",
        nargs="?",
        default=None,
        help="Target service (api, web, caddy, ...).",
    )

    exec_p = stack_sub.add_parser(
        "exec",
        help="Run a command inside a service container.",
        parents=[_globals_parser(defaults=False)],
    )
    exec_p.add_argument("service", help="Service name (api, web, caddy, postgres, ...).")
    exec_p.add_argument(
        "cmd",
        nargs=argparse.REMAINDER,
        help="Command to run inside the container.",
    )

    stack_sub.add_parser(
        "migrate",
        help="Run Alembic migrations (one-shot, staging/prod only).",
        parents=[_globals_parser(defaults=False)],
    )

    clean_p = stack_sub.add_parser(
        "clean",
        help="Stop the stack AND remove all volumes -- DESTRUCTIVE.",
        parents=[_globals_parser(defaults=False)],
    )
    clean_p.add_argument(
        "--force",
        action="store_true",
        help="Skip the confirmation prompt (dev/test only; staging/prod still prompts).",
    )

    reset_p = stack_sub.add_parser(
        "reset",
        help="Clean + remove orphan containers (DESTRUCTIVE).",
        parents=[_globals_parser(defaults=False)],
    )
    reset_p.add_argument(
        "--force",
        action="store_true",
        help="Skip the confirmation prompt (dev/test only; staging/prod still prompts).",
    )

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    if argv is None:
        argv = sys.argv[1:]
    args = parser.parse_args(argv)

    # exec: reject global flags that appear after the service name.  Without
    # this, `nodum stack exec api --env prod ls` would silently use dev (the
    # default) because --env feeds into the REMAINDER cmd list and never
    # surfaces as a recognised option.  The correct fix is argparse --; the
    # pragmatic one is to assert here and point the user at the correct form.
    if args.command == "stack" and args.stack_command == "exec":
        cmd: list[str] = getattr(args, "cmd", []) or []
        rejected = [cmd[0]] if cmd and cmd[0].split("=", 1)[0] in ("--env", "-r", "--root") else []
        if rejected:
            print(
                "Error: global flags after the service name are not allowed in "
                "`nodum stack exec`.  Pass them before `stack`:\n"
                "  nodum stack exec api --env prod ls       # wrong: --env is swallowed by the command\n"
                "  nodum stack --env prod exec api ls       # right\n"
                "  nodum stack exec postgres grep -r foo /etc   # fine\n"
                "  nodum stack exec api cp -r a b            # fine\n"
                "  nodum stack exec api -- uv run alembic upgrade head   # -- passes cmd through",
                file=sys.stderr,
            )
            return 2

    root = args.root if "root" in args else None
    if root is None:
        root = find_project_root(Path.cwd())
    env = args.env if "env" in args else DEFAULT_ENV

    deploy_dir = resolve_deploy_dir(root)

    match args.stack_command if args.command == "stack" else args.command:
        case "up":
            return stack_up(env, deploy_dir, not args.no_build)
        case "down":
            return stack_down(env, deploy_dir, args.volumes)
        case "restart":
            return stack_restart(env, deploy_dir, args.build)
        case "ps":
            return stack_ps(env, deploy_dir)
        case "logs":
            return stack_logs(env, deploy_dir, args.follow, args.service)
        case "exec":
            return stack_exec(env, deploy_dir, args.service, args.cmd)
        case "migrate":
            return stack_migrate(env, deploy_dir)
        case "clean":
            return stack_clean(env, deploy_dir, args.force)
        case "reset":
            return stack_reset(env, deploy_dir, args.force)
        case _:
            # Unreachable: add_subparsers(required=True) guarantees command is set.
            parser.print_help()
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
