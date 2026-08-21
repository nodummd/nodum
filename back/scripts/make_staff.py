"""Grant community staff to an account (the operator tool the docs mention).

    cd back && uv run python scripts/make_staff.py person@example.com

Idempotent; prints how many rows changed. The other path is setting
COMMUNITY_BOOTSTRAP_STAFF_EMAIL before first start.
"""

import asyncio
import sys

from sqlalchemy import update

from app.core.db import async_session_factory
from app.models.auth import User


async def main(email: str) -> None:
    async with async_session_factory() as db:
        result = await db.execute(update(User).where(User.email == email).values(is_staff=True))
        await db.commit()
        print(f"staff granted to {email!r}: {result.rowcount} row(s)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: uv run python scripts/make_staff.py <email>")
    asyncio.run(main(sys.argv[1]))
