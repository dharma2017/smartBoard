import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/smartboard.db")
    auth_mode: str = os.getenv("AUTH_MODE", "dev")
    app_access_token: str = os.getenv("APP_ACCESS_TOKEN", "")
    app_tenant: str = os.getenv("APP_TENANT", "personal-workspace")
    app_user: str = os.getenv("APP_USER", "personal-learner")
    oidc_issuer: str = os.getenv("OIDC_ISSUER", "")
    oidc_audience: str = os.getenv("OIDC_AUDIENCE", "")
    oidc_jwks_url: str = os.getenv("OIDC_JWKS_URL", "")
    provider: str = os.getenv("LLM_PROVIDER", "demo")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    max_objects: int = int(os.getenv("MAX_BOARD_OBJECTS", "500"))
    max_selection_objects: int = int(os.getenv("MAX_SELECTION_OBJECTS", "100"))
    max_context_chars: int = int(os.getenv("MAX_CONTEXT_CHARS", "12000"))
    max_output_tokens: int = int(os.getenv("MAX_OUTPUT_TOKENS", "1200"))
    request_timeout: float = float(os.getenv("AI_TIMEOUT_SECONDS", "60"))
    # Set explicit provider prices to record estimated monetary cost. No guessed prices.
    input_price: str = os.getenv("INPUT_USD_PER_MILLION", "")
    output_price: str = os.getenv("OUTPUT_USD_PER_MILLION", "")

    def validate(self):
        if self.auth_mode not in {"dev", "oidc", "token"}:
            raise ValueError("AUTH_MODE must be dev, token or oidc")
        if self.auth_mode == "token" and len(self.app_access_token) < 32:
            raise ValueError("APP_ACCESS_TOKEN must contain at least 32 characters")
        if self.auth_mode == "oidc" and not all(
            (self.oidc_issuer, self.oidc_audience, self.oidc_jwks_url)
        ):
            raise ValueError(
                "OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL are required"
            )
        if self.provider not in {"demo", "openai"}:
            raise ValueError("LLM_PROVIDER must be demo or openai")
        if self.provider == "openai" and not os.getenv("OPENAI_API_KEY"):
            raise ValueError("Set OPENAI_API_KEY to use LLM_PROVIDER=openai")


settings = Settings()
