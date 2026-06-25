"""LiteLLM helpers — key injection, model resolution, per-channel overrides.

LiteLLM reads provider keys from os.environ, not from arbitrary Python objects.
Call configure() once at startup to sync settings → os.environ.

Per-channel model override: add a line to CHANNEL.md frontmatter:
    llm_model: gpt-4o
or set LLM_MODEL per channel in tools.toml:
    [llm]
    model = "gpt-4o"
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import litellm
import toml

from tagopen.config import settings

logger = logging.getLogger(__name__)

# Suppress LiteLLM's verbose success logs
litellm.suppress_debug_info = True


def configure() -> None:
    """Sync API keys from settings → os.environ so LiteLLM can pick them up."""
    _set_if_nonempty("ANTHROPIC_API_KEY", settings.anthropic_api_key)
    _set_if_nonempty("OPENAI_API_KEY", settings.openai_api_key)
    _set_if_nonempty("GEMINI_API_KEY", settings.gemini_api_key)
    _set_if_nonempty("GROQ_API_KEY", settings.groq_api_key)

    logger.info("LLM configured — default model: %s", settings.llm_model)
    _log_available_providers()


def _set_if_nonempty(env_var: str, value: str) -> None:
    if value and not os.environ.get(env_var):
        os.environ[env_var] = value


def _log_available_providers() -> None:
    providers = []
    if os.environ.get("ANTHROPIC_API_KEY"):
        providers.append("Anthropic")
    if os.environ.get("OPENAI_API_KEY"):
        providers.append("OpenAI")
    if os.environ.get("GEMINI_API_KEY"):
        providers.append("Gemini")
    if os.environ.get("GROQ_API_KEY"):
        providers.append("Groq")
    if providers:
        logger.info("Available LLM providers: %s", ", ".join(providers))
    else:
        logger.warning("No LLM provider API keys found — set at least one in .env")


def resolve_model(channel_id: str | None = None) -> str:
    """Return the model to use, respecting per-channel overrides.

    Override order (highest wins):
      1. tools.toml [llm] model = "..." in channel dir
      2. LLM_MODEL env var / settings.llm_model
    """
    if channel_id:
        override = _channel_model_override(channel_id)
        if override:
            return override
    return settings.llm_model


def _channel_model_override(channel_id: str) -> str | None:
    tools_toml = settings.channels_dir / channel_id / "tools.toml"
    if not tools_toml.exists():
        return None
    try:
        config = toml.loads(tools_toml.read_text())
        return config.get("llm", {}).get("model") or None
    except Exception:
        return None


async def acompletion(channel_id: str | None = None, **kwargs):
    """Thin wrapper around litellm.acompletion that injects the resolved model."""
    kwargs.setdefault("model", resolve_model(channel_id))
    return await litellm.acompletion(**kwargs)
