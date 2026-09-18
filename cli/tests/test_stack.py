"""Tests for stack commands — verify the exact argv each verb builds.

Every verb is tested by stubbing ``subprocess.run`` and asserting the
call list matches the documented compose.sh invocation.  No Docker or
compose binary is required to run these tests.
"""

from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

import pytest

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


class FakeResult:
    def __init__(self, returncode: int = 0):
        self.returncode = returncode


class RunnerStub:
    """Record every call to ``subprocess.run`` and return a fake success."""

    def __init__(self):
        self.calls: list[tuple] = []

    def __call__(self, args, **kwargs):
        self.calls.append((list(args), kwargs))
        return FakeResult(0)


DEPLOY = Path("/tmp/nodum/deploy")
COMPOSE_SCRIPT = DEPLOY / "compose.sh"


# ---------------------------------------------------------------------------
# Helpers — monkeypatch subprocess.run + sys.stdin
# ---------------------------------------------------------------------------


def _stub_run(monkeypatch):
    stub = RunnerStub()
    monkeypatch.setattr(subprocess, "run", stub)
    return stub


class FakeStdin(io.StringIO):
    """A StringIO that pretends to be a TTY so isatty() returns True."""

    def isatty(self) -> bool:
        return True


def _fake_stdin(monkeypatch, input_text: str | None = None):
    handle = FakeStdin(input_text if input_text is not None else "")
    monkeypatch.setattr(sys, "stdin", handle)
    return handle


# ---------------------------------------------------------------------------
# stack_up
# ---------------------------------------------------------------------------


def test_stack_up_no_build(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_up("dev", DEPLOY, build=False)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "up", "-d"]


def test_stack_up_with_build(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_up("prod", DEPLOY, build=True)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "prod", "up", "-d", "--build"]


# ---------------------------------------------------------------------------
# stack_down
# ---------------------------------------------------------------------------


def test_stack_down_keeps_volumes(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_down("dev", DEPLOY, volumes=False)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "down"]


def test_stack_down_removes_volumes(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_down("dev", DEPLOY, volumes=True)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "down", "-v"]


# ---------------------------------------------------------------------------
# stack_restart
# ---------------------------------------------------------------------------


def test_stack_restart_no_build(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_restart("dev", DEPLOY, build=False)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "up",
        "-d",
        "--force-recreate",
    ]


def test_stack_restart_with_build(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_restart("dev", DEPLOY, build=True)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "up",
        "-d",
        "--force-recreate",
        "--build",
    ]


# ---------------------------------------------------------------------------
# stack_ps
# ---------------------------------------------------------------------------


def test_stack_ps(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_ps("dev", DEPLOY)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "ps"]


# ---------------------------------------------------------------------------
# stack_logs
# ---------------------------------------------------------------------------


def test_stack_logs_no_follow_no_service(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_logs("dev", DEPLOY, follow=False, service=None)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "logs"]


def test_stack_logs_follow(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_logs("dev", DEPLOY, follow=True, service=None)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "logs", "-f"]


def test_stack_logs_service(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_logs("dev", DEPLOY, follow=False, service="api")
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "logs", "api"]


def test_stack_logs_follow_service(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_logs("dev", DEPLOY, follow=True, service="web")
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "logs",
        "-f",
        "web",
    ]


# ---------------------------------------------------------------------------
# stack_exec
# ---------------------------------------------------------------------------


def test_stack_exec(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_exec(
        "dev",
        DEPLOY,
        "api",
        ["uv", "run", "alembic", "upgrade", "head"],
    )
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "exec",
        "api",
        "uv",
        "run",
        "alembic",
        "upgrade",
        "head",
    ]


def test_stack_exec_with_spaces_in_cmd(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_exec("dev", DEPLOY, "api", ["bash", "-c", "echo hi"])
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "exec",
        "api",
        "bash",
        "-c",
        "echo hi",
    ]


# ---------------------------------------------------------------------------
# stack_migrate
# ---------------------------------------------------------------------------


def test_stack_migrate_staging_uses_run_rm(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_migrate("staging", DEPLOY)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "staging",
        "run",
        "--rm",
        "migrate",
    ]


def test_stack_migrate_prod_uses_run_rm(monkeypatch):
    stub = _stub_run(monkeypatch)
    rc = stack_migrate("prod", DEPLOY)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "prod",
        "run",
        "--rm",
        "migrate",
    ]


@pytest.mark.parametrize("env", ["dev", "test"])
def test_stack_migrate_dev_test_rejects(env, monkeypatch, capsys):
    stub = _stub_run(monkeypatch)
    rc = stack_migrate(env, DEPLOY)
    assert rc == 2
    assert len(stub.calls) == 0
    captured = capsys.readouterr()
    assert "only supported on staging/prod" in captured.err
    assert "nodum stack exec api uv run alembic upgrade head" in captured.err


# ---------------------------------------------------------------------------
# stack_clean
# ---------------------------------------------------------------------------


def test_stack_clean_dev_force_skips_prompt(monkeypatch):
    _fake_stdin(monkeypatch, "")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("dev", DEPLOY, force=True)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "down", "-v"]


def test_stack_clean_dev_prompts_with_correct_input(monkeypatch):
    _fake_stdin(monkeypatch, "dev\n")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("dev", DEPLOY, force=False)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "dev", "down", "-v"]


def test_stack_clean_dev_prompts_reject(monkeypatch, capsys):
    _fake_stdin(monkeypatch, "nope\n")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("dev", DEPLOY, force=False)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "Aborted" in capsys.readouterr().err


def test_stack_clean_dev_non_tty_rejects(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    stub = _stub_run(monkeypatch)
    rc = stack_clean("dev", DEPLOY, force=False)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "refusing to run destructively without a tty" in capsys.readouterr().err


def test_stack_clean_staging_force_still_prompts(monkeypatch):
    _fake_stdin(monkeypatch, "staging\n")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("staging", DEPLOY, force=True)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "staging",
        "down",
        "-v",
    ]


def test_stack_clean_staging_force_rejects_wrong_input(monkeypatch, capsys):
    _fake_stdin(monkeypatch, "wrong\n")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("staging", DEPLOY, force=True)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "Aborted" in capsys.readouterr().err


def test_stack_clean_staging_force_non_tty_rejects(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    stub = _stub_run(monkeypatch)
    rc = stack_clean("staging", DEPLOY, force=True)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "refusing to destroy staging stack without a tty" in capsys.readouterr().err


def test_stack_clean_prod_force_still_prompts(monkeypatch):
    _fake_stdin(monkeypatch, "prod\n")
    stub = _stub_run(monkeypatch)
    rc = stack_clean("prod", DEPLOY, force=True)
    assert rc == 0
    assert stub.calls[0][0] == [str(COMPOSE_SCRIPT), "prod", "down", "-v"]


def test_stack_clean_prod_force_rejects_non_tty(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    stub = _stub_run(monkeypatch)
    rc = stack_clean("prod", DEPLOY, force=True)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "refusing to destroy prod stack without a tty" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# stack_reset
# ---------------------------------------------------------------------------


def test_stack_reset_dev_force_skips_prompt(monkeypatch):
    _fake_stdin(monkeypatch, "")
    stub = _stub_run(monkeypatch)
    rc = stack_reset("dev", DEPLOY, force=True)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "dev",
        "down",
        "-v",
        "--remove-orphans",
    ]


def test_stack_reset_staging_force_still_prompts(monkeypatch):
    _fake_stdin(monkeypatch, "staging\n")
    stub = _stub_run(monkeypatch)
    rc = stack_reset("staging", DEPLOY, force=True)
    assert rc == 0
    assert stub.calls[0][0] == [
        str(COMPOSE_SCRIPT),
        "staging",
        "down",
        "-v",
        "--remove-orphans",
    ]


def test_stack_reset_staging_force_non_tty_rejects(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    stub = _stub_run(monkeypatch)
    rc = stack_reset("staging", DEPLOY, force=True)
    assert rc == 1
    assert len(stub.calls) == 0
    assert "refusing to destroy staging stack without a tty" in capsys.readouterr().err
