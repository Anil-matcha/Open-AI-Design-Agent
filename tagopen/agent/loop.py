"""Agent loop — ReAct-style: think → tool call → observe → repeat → reply → memory curation."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from tagopen.agent.context import build_messages, build_system_prompt
from tagopen.agent.skills import maybe_create_skill
from tagopen.config import settings
from tagopen.llm import acompletion
from tagopen.memory.store import MessageStore
from tagopen.memory.writer import run_memory_curation
from tagopen.tools.registry import get_channel_tools, dispatch_tool

if TYPE_CHECKING:
    from slack_bolt.async_app import AsyncApp

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 10  # prevent runaway loops


async def run_agent_loop(
    app: "AsyncApp",
    workspace_id: str,
    channel_id: str,
    user_id: str,
    display_name: str,
    text: str,
    thread_ts: str,
    event_ts: str,
    store: MessageStore,
) -> None:
    # Persist the incoming user message
    await store.add_message(
        ts=event_ts,
        role="user",
        user_id=user_id,
        display_name=display_name,
        content=text,
        thread_ts=thread_ts,
    )

    # Fetch Slack user map for attribution (best-effort)
    try:
        members = await app.client.conversations_members(channel=channel_id)
        user_map: dict[str, str] = {}
        for uid in (members.get("members") or [])[:50]:
            info = await app.client.users_info(user=uid)
            profile = info["user"].get("profile", {})
            user_map[uid] = profile.get("display_name") or info["user"].get("real_name") or uid
    except Exception:
        user_map = {user_id: display_name}

    system_prompt = build_system_prompt(channel_id, user_map)
    messages = await build_messages(channel_id, user_id, display_name, text, thread_ts, store)
    tools = get_channel_tools(channel_id)

    tool_call_count = 0
    final_text = ""

    for _round in range(MAX_TOOL_ROUNDS):
        response = await acompletion(
            channel_id=channel_id,
            messages=[{"role": "system", "content": system_prompt}] + messages,
            tools=tools or None,
            tool_choice="auto" if tools else None,
        )

        choice = response.choices[0]
        msg = choice.message

        # Pure text response — we're done
        if not msg.tool_calls:
            final_text = msg.content or ""
            break

        # Execute each tool call
        messages.append(msg.model_dump(exclude_none=True))
        for tc in msg.tool_calls:
            tool_call_count += 1
            fn_name = tc.function.name
            fn_args = json.loads(tc.function.arguments or "{}")

            logger.info("Tool call: %s(%s) in channel=%s", fn_name, fn_args, channel_id)
            result = await dispatch_tool(fn_name, fn_args, channel_id=channel_id)

            # Handle memory write tools inline
            if fn_name in ("memory_append", "memory_replace"):
                _handle_memory_tool(channel_id, fn_name, fn_args)
                result = "Memory updated."

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": str(result),
            })
    else:
        final_text = "I reached my tool call limit. Here's what I found so far."

    if not final_text:
        final_text = "Done."

    # Post reply to Slack
    await app.client.chat_postMessage(
        channel=channel_id,
        text=final_text,
        thread_ts=thread_ts,
    )

    # Persist assistant reply
    await store.add_message(
        ts=str(__import__("time").time()),
        role="assistant",
        user_id="agent",
        display_name="agent",
        content=final_text,
        thread_ts=thread_ts,
    )

    # Inner loop: memory curation turn (Letta-inspired)
    # Agent decides what's worth persisting to MEMORY.md
    await run_memory_curation(channel_id, system_prompt, messages, final_text)

    # Skill auto-creation if task was complex (Hermes-inspired)
    if tool_call_count >= 5:
        await maybe_create_skill(channel_id, messages, final_text, tool_call_count)


def _handle_memory_tool(channel_id: str, fn_name: str, args: dict[str, Any]) -> None:
    memory_path = settings.channels_dir / channel_id / "MEMORY.md"
    memory_path.parent.mkdir(parents=True, exist_ok=True)

    current = memory_path.read_text() if memory_path.exists() else ""

    if fn_name == "memory_append":
        entry = args.get("content", "").strip()
        if entry:
            memory_path.write_text(current.rstrip() + f"\n- {entry}\n")

    elif fn_name == "memory_replace":
        old = args.get("old", "")
        new = args.get("new", "")
        memory_path.write_text(current.replace(old, new))
