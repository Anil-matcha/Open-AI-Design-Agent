"""Channel router — maps (workspace_id, channel_id) to an AgentSession and runs the loop."""

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from tagopen.agent.loop import run_agent_loop
from tagopen.memory.store import get_store

if TYPE_CHECKING:
    from slack_bolt.async_app import AsyncApp

logger = logging.getLogger(__name__)

# In-memory session registry: (workspace_id, channel_id) → AgentSession
# The key insight vs OpenClaw: session key includes channel_id, NOT user_id.
# All users in a channel share the same session.
_sessions: dict[tuple[str, str], "AgentSession"] = {}


@dataclass
class AgentSession:
    workspace_id: str
    channel_id: str
    # Shared lock so concurrent @mentions in the same channel are serialized
    # preventing context corruption from parallel writes.
    _lock: asyncio.Lock = field(default_factory=lambda: __import__("asyncio").Lock())


import asyncio  # noqa: E402 — needed for Lock reference above


def get_or_create_session(workspace_id: str, channel_id: str) -> AgentSession:
    key = (workspace_id, channel_id)
    if key not in _sessions:
        _sessions[key] = AgentSession(workspace_id=workspace_id, channel_id=channel_id)
        logger.info("New session: workspace=%s channel=%s", workspace_id, channel_id)
    return _sessions[key]


async def route_message(
    app: "AsyncApp",
    workspace_id: str,
    channel_id: str,
    user_id: str,
    text: str,
    thread_ts: str,
    event_ts: str,
) -> None:
    session = get_or_create_session(workspace_id, channel_id)
    store = await get_store(workspace_id, channel_id)

    # Fetch user display name for attribution in context
    try:
        user_info = await app.client.users_info(user=user_id)
        display_name = (
            user_info["user"].get("profile", {}).get("display_name")
            or user_info["user"].get("real_name")
            or user_id
        )
    except Exception:
        display_name = user_id

    # Serialize per-channel — prevents race conditions on shared context
    async with session._lock:
        await run_agent_loop(
            app=app,
            workspace_id=workspace_id,
            channel_id=channel_id,
            user_id=user_id,
            display_name=display_name,
            text=text,
            thread_ts=thread_ts,
            event_ts=event_ts,
            store=store,
        )
