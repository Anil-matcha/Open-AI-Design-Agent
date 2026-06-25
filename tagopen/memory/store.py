"""SQLite + FTS5 message store — one DB per workspace, one table per channel."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

import aiosqlite

from tagopen.config import settings

logger = logging.getLogger(__name__)

_CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    thread_ts   TEXT,
    channel_id  TEXT NOT NULL,
    role        TEXT NOT NULL,          -- 'user' | 'assistant'
    user_id     TEXT NOT NULL,
    display_name TEXT NOT NULL,
    content     TEXT NOT NULL,
    tool_calls  INTEGER DEFAULT 0,
    created_at  REAL NOT NULL DEFAULT (unixepoch('now', 'subsec'))
);
"""

_CREATE_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    display_name,
    content='messages',
    content_rowid='id'
);
"""

_CREATE_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, display_name)
    VALUES (new.id, new.content, new.display_name);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, display_name)
    VALUES ('delete', old.id, old.content, old.display_name);
END;
"""


class MessageStore:
    def __init__(self, db_path: Path, channel_id: str) -> None:
        self._db_path = db_path
        self._channel_id = channel_id
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.executescript(_CREATE_MESSAGES + _CREATE_FTS + _CREATE_TRIGGERS)
        await self._db.commit()

    async def add_message(
        self,
        ts: str,
        role: str,
        user_id: str,
        display_name: str,
        content: str,
        thread_ts: str | None = None,
        tool_calls: int = 0,
    ) -> None:
        assert self._db
        await self._db.execute(
            """INSERT INTO messages (ts, thread_ts, channel_id, role, user_id, display_name, content, tool_calls)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (ts, thread_ts, self._channel_id, role, user_id, display_name, content, tool_calls),
        )
        await self._db.commit()

    async def get_recent_messages(self, limit: int = 50) -> list[aiosqlite.Row]:
        assert self._db
        async with self._db.execute(
            """SELECT ts, role, user_id, display_name, content
               FROM messages
               WHERE channel_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (self._channel_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
        return list(reversed(rows))  # return chronologically

    async def search(self, query: str, limit: int = 10) -> list[aiosqlite.Row]:
        """Full-text search across channel messages."""
        assert self._db
        async with self._db.execute(
            """SELECT m.ts, m.role, m.display_name, m.content
               FROM messages_fts f
               JOIN messages m ON m.id = f.rowid
               WHERE messages_fts MATCH ? AND m.channel_id = ?
               ORDER BY rank
               LIMIT ?""",
            (query, self._channel_id, limit),
        ) as cursor:
            return await cursor.fetchall()

    async def close(self) -> None:
        if self._db:
            await self._db.close()


_stores: dict[tuple[str, str], MessageStore] = {}


async def get_store(workspace_id: str, channel_id: str) -> MessageStore:
    key = (workspace_id, channel_id)
    if key not in _stores:
        db_path = settings.data_dir / "workspaces" / workspace_id / "messages.db"
        store = MessageStore(db_path=db_path, channel_id=channel_id)
        await store.open()
        _stores[key] = store
    return _stores[key]
