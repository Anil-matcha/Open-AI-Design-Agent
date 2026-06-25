"""Slack Bolt gateway — entry point for all Slack events."""

import asyncio
import logging

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

from tagopen.config import settings
from tagopen.gateway.router import route_message

logger = logging.getLogger(__name__)

app = AsyncApp(token=settings.slack_bot_token)


@app.event("app_mention")
async def handle_mention(event: dict, say, client) -> None:
    """Handle @tagopen mentions in channels."""
    channel_id = event["channel"]
    workspace_id = (await client.auth_test())["team_id"]
    user_id = event["user"]
    text = event["text"]
    thread_ts = event.get("thread_ts") or event["ts"]

    # Acknowledge quickly with a reaction so the user knows we're working
    await client.reactions_add(channel=channel_id, timestamp=event["ts"], name="thinking_face")

    try:
        await route_message(
            app=app,
            workspace_id=workspace_id,
            channel_id=channel_id,
            user_id=user_id,
            text=text,
            thread_ts=thread_ts,
            event_ts=event["ts"],
        )
    except Exception:
        logger.exception("Error handling mention in %s", channel_id)
        await say(
            text="Sorry, I ran into an error processing that. Check the logs.",
            thread_ts=thread_ts,
        )
    finally:
        await client.reactions_remove(channel=channel_id, timestamp=event["ts"], name="thinking_face")


@app.event("message")
async def handle_message(event: dict, client) -> None:
    """Ignore regular messages — only respond to @mentions."""
    pass


async def start() -> None:
    handler = AsyncSocketModeHandler(app, settings.slack_app_token)
    logger.info("TagOpen gateway starting (Socket Mode)…")
    await handler.start_async()
