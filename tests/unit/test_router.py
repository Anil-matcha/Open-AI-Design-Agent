"""Tests for channel router — verifies channel-scoped session isolation."""

import pytest
from tagopen.gateway.router import get_or_create_session, _sessions


def setup_function():
    _sessions.clear()


def test_same_channel_returns_same_session():
    s1 = get_or_create_session("W001", "C001")
    s2 = get_or_create_session("W001", "C001")
    assert s1 is s2


def test_different_channels_return_different_sessions():
    s1 = get_or_create_session("W001", "C001")
    s2 = get_or_create_session("W001", "C002")
    assert s1 is not s2


def test_different_workspaces_return_different_sessions():
    s1 = get_or_create_session("W001", "C001")
    s2 = get_or_create_session("W002", "C001")
    assert s1 is not s2


def test_session_has_channel_scoped_identity():
    s = get_or_create_session("W001", "C001")
    assert s.workspace_id == "W001"
    assert s.channel_id == "C001"
