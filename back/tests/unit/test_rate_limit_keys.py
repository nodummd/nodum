"""How the rate limiter decides *who* a request is.

Getting this wrong is not a hardening gap but a bypass: reading the leftmost
X-Forwarded-For entry lets a caller mint a fresh bucket per forged value and
walk through the auth brute-force limit.
"""

from starlette.datastructures import Headers

from app.core.middlewares.rate_limit_middleware import client_ip_from
from app.settings.common import CommonSettings


class _Client:
    def __init__(self, host: str) -> None:
        self.host = host


class _Request:
    """Just the two attributes client_ip_from touches."""

    def __init__(self, peer: str | None, forwarded: str | None = None) -> None:
        self.client = _Client(peer) if peer else None
        self.headers = Headers({"X-Forwarded-For": forwarded} if forwarded else {})


def _settings(*, trust: bool, hops: int = 1) -> CommonSettings:
    return CommonSettings(TRUST_PROXY_HEADERS=trust, TRUSTED_PROXY_HOPS=hops)


def test_ignores_the_header_when_no_proxy_is_trusted() -> None:
    request = _Request("10.0.0.9", forwarded="1.2.3.4")
    assert client_ip_from(request, _settings(trust=False)) == "10.0.0.9"


def test_forged_prefix_cannot_displace_the_real_client() -> None:
    """A proxy appends, so a client-sent value ends up to the LEFT of the truth."""
    request = _Request("10.0.0.9", forwarded="1.2.3.4, 203.0.113.7")
    assert client_ip_from(request, _settings(trust=True)) == "203.0.113.7"


def test_single_replacing_proxy() -> None:
    """nginx `proxy_set_header X-Forwarded-For $remote_addr` leaves one entry."""
    request = _Request("10.0.0.9", forwarded="203.0.113.7")
    assert client_ip_from(request, _settings(trust=True)) == "203.0.113.7"


def test_two_trusted_hops_skips_the_inner_proxy() -> None:
    request = _Request("10.0.0.9", forwarded="203.0.113.7, 10.0.0.8")
    assert client_ip_from(request, _settings(trust=True, hops=2)) == "203.0.113.7"


def test_short_chain_falls_back_to_the_socket() -> None:
    """Fewer hops than configured means every entry is client-writable."""
    request = _Request("10.0.0.9", forwarded="1.2.3.4")
    assert client_ip_from(request, _settings(trust=True, hops=2)) == "10.0.0.9"


def test_empty_and_whitespace_entries_are_discarded() -> None:
    request = _Request("10.0.0.9", forwarded=" , 203.0.113.7 ,")
    assert client_ip_from(request, _settings(trust=True)) == "203.0.113.7"


def test_missing_header_falls_back_to_the_socket() -> None:
    assert client_ip_from(_Request("10.0.0.9"), _settings(trust=True)) == "10.0.0.9"


def test_no_peer_at_all_is_not_a_crash() -> None:
    assert client_ip_from(_Request(None), _settings(trust=False)) == "unknown"
