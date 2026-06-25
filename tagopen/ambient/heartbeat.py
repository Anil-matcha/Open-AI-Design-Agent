"""Ambient heartbeat — proactive channel monitoring (Phase 3 stub).

The scheduler calls run_heartbeat(channel_id) on a per-channel cron.
It assembles an observation dump and asks the LLM: "anything worth surfacing?"
If yes, it posts to the channel. If no, it stays silent (SILENT sentinel).
"""

from __future__ import annotations

import logging

import litellm

from tagopen.config import settings
from tagopen.memory.store import get_store

logger = logging.getLogger(__name__)

_HEARTBEAT_PROMPT = """\
You are monitoring a Slack channel as a proactive AI teammate.
Below is a summary of recent activity.

Your job: decide if anything is worth surfacing proactively.
Only post if there's genuine value — a stale thread needing follow-up,
a deadline approaching, an unresolved question, or a risk you spotted.

If nothing is worth surfacing, respond with exactly: SILENT
Otherwise, write the message you would post to the channel (concise, actionable).
"""


async def run_heartbeat(
    app,
    workspace_id: str,
    channel_id: str,
) -> None:
    store = await get_store(workspace_id, channel_id)
    recent = await store.get_recent_messages(limit=30)

    if not recent:
        return

    summary_lines = []
    for row in recent:
        summary_lines.append(f"[{row['display_name']}]: {row['content'][:200]}")
    summary = "\n".join(summary_lines)

    try:
        response = await litellm.acompletion(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _HEARTBEAT_PROMPT},
                {"role": "user", "content": f"Recent messages:\n{summary}"},
            ],
        )
        text = (response.choices[0].message.content or "").strip()
        if text and text != "SILENT":
            await app.client.chat_postMessage(channel=channel_id, text=text)
            logger.info("Heartbeat posted to channel=%s", channel_id)
    except Exception:
        logger.exception("Heartbeat failed for channel=%s", channel_id)
