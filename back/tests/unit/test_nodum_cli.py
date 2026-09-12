"""Unit tests for the nodum CLI — verify each verb builds the correct argv."""

from __future__ import annotations

import io
import subprocess
import pytest
from pathlib import Path

from app.nodum_cli import (
    _SUB_COMMANDS,
    build_parser,
    cmd_clean,
    cmd_exec,
    cmd_logs,
    cmd_migrate,
    cmd_restart,
    cmd_start,
    cmd_status,
    cmd_stop,
    _shift_globals_before_command,
    main,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, returncode: int = 0):
        self.returncode = returncode


class RunnerStub:
    """Record every call to subprocess.run and return a fake success."""

    def __init__(self):
        self.calls: list[tuple] = []

    def __call__(self, args, **kwargs):
        self.calls.append((list(args), kwargs))
        return FakeResult(0)


_stdin_backup = None


def _patch_stdin(stdin_obj):
    global _stdin_backup
    _stdin_backup = subprocess.stdin
    subprocess.stdin = stdin_obj


def _restore_stdin():
    global _stdin_backup
    subprocess.stdin = _stdin_backup


# ---------------------------------------------------------------------------
# _SUB_COMMANDS
# ---------------------------------------------------------------------------


def test_sub_commands_contains_all_verbs():
    expected = frozenset({"start", "stop", "restart", "status", "logs", "exec", "migrate", "clean"})
    assert _SUB_COMMANDS == expected


# ---------------------------------------------------------------------------
# build_parser — subcommand registration
# ---------------------------------------------------------------------------


def test_build_parser_required_command():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args([])


def test_build_parser_recognises_all_verbs():
    parser = build_parser()
    for verb in _SUB_COMMANDS:
        ns = parser.parse_args([verb])
        assert ns.command == verb
        assert ns.env == "dev"


def test_build_parser_global_flags_before_and_after_verb():
    parser = build_parser()
    for args in (["--env", "prod", "start"], ["start", "--env", "prod"]):
        ns = parser.parse_args(args)
        assert ns.command == "start"
        assert ns.env == "prod"


def test_build_parser_env_choices():
    parser = build_parser()
    for env in ["dev", "test", "staging", "prod"]:
        ns = parser.parse_args(["start", "--env", env])
        assert ns.env == env

    with pytest.raises(SystemExit):
        parser.parse_args(["start", "--env", "bogus"])


# ---------------------------------------------------------------------------
# build_parser — subparser flag defaults
# ---------------------------------------------------------------------------


def test_start_has_no_build_flag():
    parser = build_parser()
    ns = parser.parse_args(["start", "--no-build"])
    assert ns.no_build is True


def test_restart_has_build_flag():
    parser = build_parser()
    ns = parser.parse_args(["restart", "--build"])
    assert ns.build is True


def test_restart_no_build_flag_removed():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["restart", "--no-build"])


def test_clean_has_force_flag():
    parser = build_parser()
    ns = parser.parse_args(["clean", "--force"])
    assert ns.force is True


def test_logs_has_follow_and_optional_service():
    parser = build_parser()
    ns = parser.parse_args(["logs", "-f", "api"])
    assert ns.follow is True
    assert ns.service == "api"

    ns = parser.parse_args(["logs"])
    assert ns.follow is False
    assert ns.service is None


def test_exec_has_service_and_remainder_cmd():
    parser = build_parser()
    ns = parser.parse_args(["exec", "api", "uv", "run", "alembic", "upgrade", "head"])
    assert ns.service == "api"
    assert ns.cmd == ["uv", "run", "alembic", "upgrade", "head"]


# ---------------------------------------------------------------------------
# _shift_globals_before_command — argv rewriting
# ---------------------------------------------------------------------------


def test_shift_globals_empty():
    assert _shift_globals_before_command([]) == []
    assert _shift_globals_before_command(None) == []


def test_shift_globals_simple_verb():
    assert _shift_globals_before_command(["start"]) == ["start"]


def test_shift_globals_env_before_verb():
    assert _shift_globals_before_command(["--env", "prod", "start"]) == [
        "start", "--env", "prod"
    ]


def test_shift_globals_env_after_verb_unchanged():
    assert _shift_globals_before_command(["start", "--env", "prod"]) == [
        "start", "--env", "prod"
    ]


def test_shift_globals_root_flag():
    assert _shift_globals_before_command(["-r", "/opt/nodum", "start"]) == [
        "start", "-r", "/opt/nodum"
    ]


def test_shift_globals_mixed_flags():
    assert _shift_globals_before_command(
        ["--env", "prod", "--no-build", "start"]
    ) == ["start", "--env", "prod", "--no-build"]


def test_shift_globals_flag_value_not_mistaken_for_verb():
    argv = ["--env", "prod", "-r", "logs", "start"]
    assert _shift_globals_before_command(argv) == [
        "start", "--env", "prod", "-r", "logs"
    ]


# ---------------------------------------------------------------------------
# cmd_* — exact argv each verb passes to subprocess.run
# ---------------------------------------------------------------------------


def test_cmd_start_without_build():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_start("dev", Path("/tmp"), build=False)
    finally:
        _restore_stdin()
        subprocess.run = subprocess.__dict__.get("_orig_run", subprocess.run)
    assert rc == 0
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "up", "-d"]


def test_cmd_start_with_build():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_start("prod", Path("/tmp"), build=True)
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == [
        "/tmp/deploy/compose.sh", "prod", "up", "-d", "--build"
    ]


def test_cmd_stop():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_stop("dev", Path("/tmp"))
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "down"]


def test_cmd_restart_force_recreates():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_restart("dev", Path("/tmp"), build=False)
    finally:
        _restore_stdin()
    args = stub.calls[0][0]
    assert args[1:] == ["dev", "up", "-d", "--force-recreate"]
    assert rc == 0


def test_cmd_restart_with_build():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_restart("dev", Path("/tmp"), build=True)
    finally:
        _restore_stdin()
    args = stub.calls[0][0]
    assert args[1:] == ["dev", "up", "-d", "--force-recreate", "--build"]


def test_cmd_status():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_status("dev", Path("/tmp"))
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "ps"]


def test_cmd_logs_without_follow():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_logs("dev", Path("/tmp"), follow=False, service=None)
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "logs"]


def test_cmd_logs_follow_api():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_logs("dev", Path("/tmp"), follow=True, service="api")
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "logs", "-f", "api"]


def test_cmd_exec():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_exec(
            "dev", Path("/tmp"), "api",
            ["uv", "run", "alembic", "upgrade", "head"]
        )
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == [
        "/tmp/deploy/compose.sh", "dev", "exec", "api",
        "uv", "run", "alembic", "upgrade", "head"
    ]


def test_cmd_migrate_staging_uses_run():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_migrate("staging", Path("/tmp"))
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == [
        "/tmp/deploy/compose.sh", "staging", "run", "--rm", "migrate"
    ]
    assert rc == 0


def test_cmd_migrate_dev_rejects():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_migrate("dev", Path("/tmp"))
    finally:
        _restore_stdin()
    assert rc == 2
    assert len(stub.calls) == 0


def test_cmd_migrate_test_rejects():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_migrate("test", Path("/tmp"))
    finally:
        _restore_stdin()
    assert rc == 2
    assert len(stub.calls) == 0


def test_cmd_clean_dev_force_skips_prompt():
    stub = RunnerStub()
    _patch_stdin(io.StringIO())
    subprocess.run = stub
    try:
        rc = cmd_clean("dev", Path("/tmp"), force=True)
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "down", "-v"]
    assert rc == 0


def test_cmd_clean_dev_prompts():
    stub = RunnerStub()
    _patch_stdin(io.StringIO("dev\n"))
    subprocess.run = stub
    try:
        rc = cmd_clean("dev", Path("/tmp"), force=False)
    finally:
        _restore_stdin()
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "dev", "down", "-v"]


def test_cmd_clean_prod_force_requires_confirmation_interactive():
    """--force on staging/prod must still prompt for confirmation."""
    stub = RunnerStub()
    _patch_stdin(io.StringIO("prod\n"))
    subprocess.run = stub
    try:
        rc = cmd_clean("prod", Path("/tmp"), force=True)
    finally:
        _restore_stdin()
    # Should call compose down -v after the second confirmation
    assert stub.calls[0][0] == ["/tmp/deploy/compose.sh", "prod", "down", "-v"]
    assert rc == 0


def test_cmd_clean_prod_force_rejects_non_tty():
    """--force on staging/prod must refuse when no TTY."""
    stub = RunnerStub()
    _patch_stdin(io.StringIO(""))
    subprocess.run = stub
    try:
        rc = cmd_clean("prod", Path("/tmp"), force=True)
    finally:
        _restore_stdin()
    assert rc != 0  # should refuse
    assert len(stub.calls) == 0  # no compose invocation
