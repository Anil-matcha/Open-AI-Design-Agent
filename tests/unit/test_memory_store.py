"""Tests for SQLite message store."""

import pytest
from pathlib import Path
from tagopen.memory.store import MessageStore


@pytest.fixture
async def store(tmp_path):
    db_path = tmp_path / "test.db"
    s = MessageStore(db_path=db_path, channel_id="C001")
    await s.open()
    yield s
    await s.close()


async def test_add_and_retrieve_message(store):
    await store.add_message(
        ts="1234567890.000001",
        role="user",
        user_id="U001",
        display_name="alice",
        content="hello world",
    )
    rows = await store.get_recent_messages(limit=10)
    assert len(rows) == 1
    assert rows[0]["content"] == "hello world"
    assert rows[0]["display_name"] == "alice"


async def test_message_ordering(store):
    for i in range(5):
        await store.add_message(
            ts=f"100000000{i}.000000",
            role="user",
            user_id="U001",
            display_name="alice",
            content=f"message {i}",
        )
    rows = await store.get_recent_messages(limit=10)
    contents = [r["content"] for r in rows]
    assert contents == [f"message {i}" for i in range(5)]


async def test_fts_search(store):
    await store.add_message(
        ts="1.0", role="user", user_id="U1", display_name="bob", content="deploy the staging server"
    )
    await store.add_message(
        ts="2.0", role="user", user_id="U1", display_name="bob", content="update the README docs"
    )
    results = await store.search("staging")
    assert len(results) == 1
    assert "staging" in results[0]["content"]


async def test_channel_isolation(tmp_path):
    db_path = tmp_path / "shared.db"
    store_a = MessageStore(db_path=db_path, channel_id="C001")
    store_b = MessageStore(db_path=db_path, channel_id="C002")
    await store_a.open()
    await store_b.open()

    await store_a.add_message(ts="1.0", role="user", user_id="U1", display_name="a", content="channel A msg")
    await store_b.add_message(ts="2.0", role="user", user_id="U1", display_name="b", content="channel B msg")

    rows_a = await store_a.get_recent_messages()
    rows_b = await store_b.get_recent_messages()

    assert len(rows_a) == 1 and rows_a[0]["content"] == "channel A msg"
    assert len(rows_b) == 1 and rows_b[0]["content"] == "channel B msg"

    await store_a.close()
    await store_b.close()
