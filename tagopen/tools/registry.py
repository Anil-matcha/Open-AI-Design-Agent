"""Tool registry — loads allowed tools per channel from TOOLS.md / tools.toml.

All tools are exposed as MCP-compatible function schemas so the agent can call them.
Built-in tools are always available. Channel admins can add MCP servers via TOOLS.md.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import toml

from tagopen.config import settings
from tagopen.tools.builtins import BUILTIN_TOOLS, dispatch_builtin

logger = logging.getLogger(__name__)

# Cache parsed tool configs per channel
_tool_configs: dict[str, list[dict]] = {}


def get_channel_tools(channel_id: str) -> list[dict]:
    """Return LiteLLM-compatible tool schemas for this channel."""
    tools = list(BUILTIN_TOOLS)  # always include built-ins

    tools_toml_path = settings.channels_dir / channel_id / "tools.toml"
    if tools_toml_path.exists():
        try:
            config = toml.loads(tools_toml_path.read_text())
            for server in config.get("mcp_server", []):
                # For now, MCP servers are registered but called via HTTP
                # Full MCP client implementation in Phase 2
                logger.debug("MCP server registered: %s for channel=%s", server.get("name"), channel_id)
        except Exception:
            logger.exception("Failed to parse tools.toml for channel=%s", channel_id)

    return tools


async def dispatch_tool(fn_name: str, args: dict[str, Any], channel_id: str) -> Any:
    """Dispatch a tool call to built-ins or MCP servers."""
    if fn_name in {t["function"]["name"] for t in BUILTIN_TOOLS}:
        return await dispatch_builtin(fn_name, args)

    # Memory tools are handled directly in the agent loop
    if fn_name in ("memory_append", "memory_replace"):
        return None

    logger.warning("Unknown tool: %s in channel=%s", fn_name, channel_id)
    return f"Tool '{fn_name}' not found."
