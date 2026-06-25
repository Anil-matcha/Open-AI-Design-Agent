"""Skill auto-creation after complex tasks (Hermes-inspired)."""

from __future__ import annotations

import logging
from datetime import date

from tagopen.config import settings
from tagopen.llm import acompletion

logger = logging.getLogger(__name__)

_SKILL_CREATION_PROMPT = """\
The agent just completed a complex multi-step task. Review the conversation below and decide
whether it reveals a reusable procedure worth saving as a skill.

A skill is worth saving if:
- The task involved a non-obvious sequence of steps
- The same task is likely to come up again in this channel
- The agent made useful discoveries (gotchas, correct tool order, edge cases)

If yes, write a SKILL.md with this exact format:

---
name: <short-kebab-slug>
description: <one sentence — what task this skill handles>
created: {today}
tool_calls_in_session: {tool_calls}
uses: 0
last_used: null
status: active
---

## When to use this
<1-2 sentences>

## Steps
<numbered list>

## Known gotchas
<bullet list, or "None">

If no skill is worth saving, respond with exactly: SKIP
"""


async def maybe_create_skill(
    channel_id: str,
    messages: list[dict],
    final_reply: str,
    tool_call_count: int,
) -> None:
    skills_dir = settings.channels_dir / channel_id / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    conversation_summary = _summarize_messages(messages[-20:])  # last 20 to keep prompt tight
    prompt = _SKILL_CREATION_PROMPT.format(today=date.today(), tool_calls=tool_call_count)

    try:
        response = await acompletion(
            channel_id=channel_id,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Conversation:\n{conversation_summary}\n\nFinal reply:\n{final_reply}"},
            ],
        )
        content = response.choices[0].message.content or ""
        if content.strip() == "SKIP":
            return

        # Extract the name from the frontmatter
        name = "unnamed"
        for line in content.splitlines():
            if line.startswith("name:"):
                name = line.split(":", 1)[1].strip()
                break

        skill_path = skills_dir / f"{name}.md"
        # Don't overwrite existing skills
        if skill_path.exists():
            skill_path = skills_dir / f"{name}-{int(__import__('time').time())}.md"

        skill_path.write_text(content)
        logger.info("Skill created: %s in channel=%s", skill_path.name, channel_id)

    except Exception:
        logger.exception("Skill creation failed for channel=%s", channel_id)


def _summarize_messages(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content") or ""
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
        if role in ("user", "assistant") and content:
            lines.append(f"{role.upper()}: {content[:300]}")
    return "\n".join(lines)
