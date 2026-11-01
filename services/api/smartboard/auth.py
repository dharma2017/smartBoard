from dataclasses import dataclass
import secrets
import jwt
from fastapi import Request
from .config import settings
from .errors import ApiError


@dataclass(frozen=True)
class Actor:
    tenant: str
    user: str


_jwks = (
    jwt.PyJWKClient(settings.oidc_jwks_url, cache_keys=True)
    if settings.oidc_jwks_url
    else None
)


def actor(request: Request) -> Actor:
    if settings.auth_mode == "dev":
        if not request.client or request.client.host not in {"127.0.0.1", "::1"}:
            raise ApiError(
                403,
                "ACCESS_DENIED",
                "Local development sessions are only available on loopback.",
            )
        # Client-supplied user or tenant headers never establish identity.
        return Actor("local-workspace", "local-learner")
    token = request.headers.get("authorization", "")
    if not token.startswith("Bearer "):
        raise ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")
    if settings.auth_mode == "token":
        if not settings.app_access_token or not secrets.compare_digest(
            token[7:], settings.app_access_token
        ):
            raise ApiError(401, "UNAUTHENTICATED", "The app access token is invalid.")
        return Actor(settings.app_tenant, settings.app_user)
    try:
        raw = token[7:]
        key = _jwks.get_signing_key_from_jwt(raw).key
        claims = jwt.decode(
            raw,
            key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
            options={"require": ["exp", "sub", "tenant_id"]},
        )
        if not claims["tenant_id"] or not claims["sub"]:
            raise ValueError("Missing membership")
        return Actor(str(claims["tenant_id"]), str(claims["sub"]))
    except (jwt.PyJWTError, ValueError):
        raise ApiError(
            401, "UNAUTHENTICATED", "Your session could not be verified."
        ) from None
