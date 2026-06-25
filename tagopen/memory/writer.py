"""Memory curation turn — inner loop (Letta-inspired).

After the agent replies, it gets one more LLM call to decide what
(if anything) to write to MEMORY.md. This keeps memory clean and
agent-curated rather than a noisy append-only log.
"""

from __future__ import annotations

import logging

from tagopen.llm import acompletion

logger = logging.getLogger(__name__)

_CURATION_PROMPT = """\
You just responded to a message in a Slack channel. Review the exchange below.

Your job: decide if anything should be persisted to the channel's long-term memory (MEMORY.md).
Only save facts that future sessions would genuinely benefit from knowing:
- Team conventions or preferences that came up
- Decisions made ("we decided to use X")
- Important context about the team or project
- Corrections to things you got wrong

Do NOT save:
- Transient task results (code output, search results)
- Things already in MEMORY.md
- Obvious facts that can be looked up

If something is worth saving, call memory_append or memory_replace.
If nothing is worth saving, do nothing — respond with an empty message.
"""

_MEMORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "memory_append",
            "description": "Append a new fact or decision to MEMORY.md",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The fact to persist (one concise bullet)"},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_replace",
            "description": "Replace an outdated fact in MEMORY.md with an updated one",
            "parameters": {
                "type": "object",
                "properties": {
                    "old": {"type": "string", "description": "The exact text to replace"},
                    "new": {"type": "string", "description": "The replacement text"},
                },
                "required": ["old", "new"],
            },
        },
    },
]


async def run_memory_curation(
    channel_id: str,
    system_prompt: str,
    messages: list[dict],
    final_reply: str,
) -> None:
    try:
        response = await acompletion(
            channel_id=channel_id,
            messages=[
                {"role": "system", "content": _CURATION_PROMPT},
                # Provide the last few turns as context
                *messages[-6:],
                {"role": "assistant", "content": final_reply},
            ],
            tools=_MEMORY_TOOLS,
            tool_choice="auto",
        )

        msg = response.choices[0].message
        if not msg.tool_calls:
            return

        import json
        from tagopen.agent.loop import _handle_memory_tool

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            fn_args = json.loads(tc.function.arguments or "{}")
            if fn_name in ("memory_append", "memory_replace"):
                _handle_memory_tool(channel_id, fn_name, fn_args)
                logger.info("Memory updated via curation: %s in channel=%s", fn_name, channel_id)

    except Exception:
        logger.exception("Memory curation failed for channel=%s", channel_id)
