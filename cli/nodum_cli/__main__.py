"""Allow ``python -m nodum_cli`` to run the CLI directly."""

from nodum_cli.main import main

if __name__ == "__main__":
    raise SystemExit(main())
