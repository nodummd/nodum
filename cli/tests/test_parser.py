"""Tests for argument parsing — flag ordering, subcommand registration, defaults.

These are pure-function tests with no I/O: they assert the namespace
``build_parser().parse_args(...)`` returns for every documented invocation,
including both ``--env before stack`` and ``--env after stack <verb>``
orderings, as well as ``--env before/after the verb`` under ``nodum stack``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from nodum_cli.main import ENV_CHOICES, SUB_COMMANDS, build_parser, main

_SUB_COMMANDS = SUB_COMMANDS


# ---------------------------------------------------------------------------
# build_parser — required command
# ---------------------------------------------------------------------------


def test_build_parser_requires_command():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args([])


def test_build_parser_recognises_stack_subcommand():
    parser = build_parser()
    # "stack" alone requires stack_command — use "stack up" to verify the
    # intermediate namespace.
    ns = parser.parse_args(["stack", "up"])
    assert ns.command == "stack"
    assert ns.stack_command == "up"
    assert ns.env == "dev"


def test_build_parser_recognises_all_stack_verbs():
    parser = build_parser()
    for verb in _SUB_COMMANDS:
        argv = ["stack", verb]
        if verb == "exec":
            argv.append("api")
        ns = parser.parse_args(argv)
        assert ns.command == "stack"
        assert ns.stack_command == verb
        assert ns.env == "dev"


# ---------------------------------------------------------------------------
# build_parser — both --env orderings resolve identically
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("args", [["--env", "prod", "stack", "up"], ["stack", "--env", "prod", "up"]])
def test_env_before_and_after_stack(args):
    parser = build_parser()
    ns = parser.parse_args(args)
    assert ns.command == "stack"
    assert ns.stack_command == "up"
    assert ns.env == "prod"


@pytest.mark.parametrize(
    "args",
    [
        ["stack", "up", "--env", "prod"],
        ["stack", "--env", "prod", "up"],
    ],
)
def test_env_before_and_after_verb_under_stack(args):
    parser = build_parser()
    ns = parser.parse_args(args)
    assert ns.command == "stack"
    assert ns.stack_command == "up"
    assert ns.env == "prod"


@pytest.mark.parametrize("env", ENV_CHOICES)
def test_env_choices(env):
    parser = build_parser()
    ns = parser.parse_args(["stack", "up", "--env", env])
    assert ns.env == env


def test_env_rejects_bogus():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["stack", "up", "--env", "bogus"])


# ---------------------------------------------------------------------------
# build_parser — subcommand-specific flags under stack
# ---------------------------------------------------------------------------


def test_up_has_no_build_flag():
    parser = build_parser()
    ns = parser.parse_args(["stack", "up", "--no-build"])
    assert ns.no_build is True


def test_up_default_no_build_false():
    parser = build_parser()
    ns = parser.parse_args(["stack", "up"])
    assert ns.no_build is False


def test_down_has_volumes_flag():
    parser = build_parser()
    ns = parser.parse_args(["stack", "down", "-v"])
    assert ns.volumes is True


def test_restart_has_build_flag():
    parser = build_parser()
    ns = parser.parse_args(["stack", "restart", "--build"])
    assert ns.build is True


def test_restart_default_build_false():
    parser = build_parser()
    ns = parser.parse_args(["stack", "restart"])
    assert ns.build is False


def test_restart_rejects_no_build():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["stack", "restart", "--no-build"])


def test_logs_has_follow_and_optional_service():
    parser = build_parser()
    ns = parser.parse_args(["stack", "logs", "-f", "api"])
    assert ns.follow is True
    assert ns.service == "api"

    ns = parser.parse_args(["stack", "logs"])
    assert ns.follow is False
    assert ns.service is None


def test_logs_follow_short_and_long():
    parser = build_parser()
    for args in [["stack", "logs", "-f"], ["stack", "logs", "--follow"]]:
        ns = parser.parse_args(args)
        assert ns.follow is True


def test_exec_has_service_and_remainder_cmd():
    parser = build_parser()
    ns = parser.parse_args(["stack", "exec", "api", "uv", "run", "alembic", "upgrade", "head"])
    assert ns.service == "api"
    assert ns.cmd == ["uv", "run", "alembic", "upgrade", "head"]


def test_exec_allows_empty_cmd():
    parser = build_parser()
    ns = parser.parse_args(["stack", "exec", "api"])
    assert ns.service == "api"
    assert ns.cmd == []


def test_clean_has_force_flag():
    parser = build_parser()
    ns = parser.parse_args(["stack", "clean", "--force"])
    assert ns.force is True


def test_clean_default_force_false():
    parser = build_parser()
    ns = parser.parse_args(["stack", "clean"])
    assert ns.force is False


def test_reset_has_force_flag():
    parser = build_parser()
    ns = parser.parse_args(["stack", "reset", "--force"])
    assert ns.force is True


def test_reset_default_force_false():
    parser = build_parser()
    ns = parser.parse_args(["stack", "reset"])
    assert ns.force is False


def test_reset_rejects_no_build():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["stack", "reset", "--no-build"])


def test_migrate_has_no_extra_flags():
    parser = build_parser()
    ns = parser.parse_args(["stack", "migrate"])
    assert ns.command == "stack"
    assert ns.stack_command == "migrate"
    assert ns.env == "dev"


# ---------------------------------------------------------------------------
# build_parser — global flags: -r / --root
# ---------------------------------------------------------------------------


def test_root_flag_before_stack():
    parser = build_parser()
    ns = parser.parse_args(["-r", "/opt/nodum", "stack", "up"])
    assert ns.root == Path("/opt/nodum").resolve()
    assert ns.command == "stack"
    assert ns.stack_command == "up"


def test_root_flag_after_verb_under_stack():
    parser = build_parser()
    ns = parser.parse_args(["stack", "up", "-r", "/opt/nodum"])
    assert ns.root == Path("/opt/nodum").resolve()
    assert ns.command == "stack"
    assert ns.stack_command == "up"


def test_root_long_flag():
    parser = build_parser()
    ns = parser.parse_args(["--root", "/opt/nodum", "stack", "up"])
    assert ns.root == Path("/opt/nodum").resolve()
    assert ns.command == "stack"
    assert ns.stack_command == "up"


def test_root_absent_defaults_to_none():
    parser = build_parser()
    ns = parser.parse_args(["stack", "up"])
    assert "root" in ns
    assert ns.root is None


# ---------------------------------------------------------------------------
# main() — empty argv exits via argparse
# ---------------------------------------------------------------------------


def test_main_empty_argv():
    """Explicit empty argv must not read sys.argv."""
    with pytest.raises(SystemExit):
        main([])


def test_main_none_argv_uses_sys_argv(monkeypatch):
    """main(None) reads sys.argv[1:]; monkeypatch to a known invalid command."""
    monkeypatch.setattr(sys, "argv", ["nodum", "not-a-command"])
    with pytest.raises(SystemExit):
        main(None)
