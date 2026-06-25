"""Global settings loaded from environment / .env file."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Slack
    slack_bot_token: str
    slack_app_token: str

    # LLM — LiteLLM model string, e.g. "gpt-4o", "claude-sonnet-4-6", "gemini/gemini-2.0-flash"
    llm_model: str = "claude-sonnet-4-6"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""

    # Storage
    data_dir: Path = Path("./data")

    # Limits
    default_max_tokens_per_request: int = 50_000
    default_max_tokens_per_day: int = 500_000
    context_window_messages: int = 50

    @property
    def channels_dir(self) -> Path:
        return self.data_dir / "channels"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "tagopen.db"


settings = Settings()  # type: ignore[call-arg]
