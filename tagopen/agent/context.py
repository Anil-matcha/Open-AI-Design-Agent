"""Context assembler — builds the system prompt and message list for the LLM."""

from __future__ import annotations

import logging
from pathlib import Path

from tagopen.config import settings
from tagopen.memory.store import MessageStore

logger = logging.getLogger(__name__)

_DEFAULT_CHANNEL_MD = """\
# Channel Agent

You are a helpful AI teammate in this Slack channel.
Be concise, direct, and technical. Ask clarifying questions before taking big actions.
"""


def _read_channel_file(channel_id: str, filename: str, default: str = "") -> str:
    path = settings.channels_dir / channel_id / filename
    if path.exists():
        return path.read_text()
    return default


def build_system_prompt(channel_id: str, user_map: dict[str, str]) -> str:
    """Assemble the system prompt from CHANNEL.md + MEMORY.md + active skills."""
    channel_md = _read_channel_file(channel_id, "CHANNEL.md", _DEFAULT_CHANNEL_MD)
    memory_md = _read_channel_file(channel_id, "MEMORY.md", "")
    skills = _load_skills(channel_id)

    parts = [channel_md.strip()]

    if memory_md.strip():
        parts.append(f"## What I know about this channel\n\n{memory_md.strip()}")

    if skills:
        skill_block = "\n\n".join(f"### Skill: {name}\n{content}" for name, content in skills)
        parts.append(f"## Available skills\n\n{skill_block}")

    parts.append(
        "## Multi-user context\n"
        "Messages are prefixed with [timestamp @username]. "
        "You are a shared teammate — anyone in the channel can see this conversation. "
        "When following up, address the relevant person by @username."
    )

    parts.append(
        "## Memory tools\n"
        "After responding you may call `memory_append` or `memory_replace` to persist "
        "important facts, decisions, or conventions to MEMORY.md. Only save what future "
        "sessions would genuinely benefit from knowing."
    )

    return "\n\n---\n\n".join(parts)


def _load_skills(channel_id: str) -> list[tuple[str, str]]:
    skills_dir = settings.channels_dir / channel_id / "skills"
    if not skills_dir.exists():
        return []
    results = []
    for path in sorted(skills_dir.glob("*.md")):
        content = path.read_text()
        # Skip archived skills
        if "status: archived" in content:
            continue
        results.append((path.stem, content))
    return results


async def build_messages(
    channel_id: str,
    user_id: str,
    display_name: str,
    text: str,
    thread_ts: str,
    store: MessageStore,
) -> list[dict]:
    """Build the messages list: recent channel history + current message."""
    recent = await store.get_recent_messages(limit=settings.context_window_messages)

    messages: list[dict] = []
    for row in recent:
        ts_str = row["ts"][:16].replace("T", " ")  # trim to minute
        prefix = f"[{ts_str} @{row['display_name']}]"
        role = "assistant" if row["role"] == "assistant" else "user"
        messages.append({"role": role, "content": f"{prefix} {row['content']}"})

    # Append current user message
    messages.append({"role": "user", "content": f"[@{display_name}] {text}"})
    return messages
