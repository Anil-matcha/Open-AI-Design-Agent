# TagOpen — Open Source Claude Tag Alternative
> Self-hostable, channel-native AI teammate for Slack (and beyond)

**Last updated:** 2026-06-25  
**Status:** Pre-build planning

---

## What We're Building

An open source alternative to Anthropic's Claude Tag. Claude Tag's core insight is that AI in the workplace should be a **shared channel teammate**, not a personal per-user chatbot. One agent per channel, shared by the whole team, with admin-controlled tool access and ambient monitoring.

**Tagline:** *The self-hostable, multiplayer AI teammate. LLM-agnostic. Channel-native. No vendor lock-in.*

### What makes this different from existing open source bots
- **OpenClaw** — closest competitor. Mature (Node/TS, 50+ platforms). But it's a personal assistant — defaults to per-user DM isolation, explicitly warns against sharing agent context. Wrong default for us.
- **Hermes Agent** — best architecture ideas (5-pillar model, skill auto-creation, self-improving crons). But also per-user.
- **open-cowork / OpenWork** — Claude Cowork clones, file/desktop focused, not channel-native.

The gap nobody has filled: **channel-scoped shared agent identity with multi-user attribution and admin governance.**

---

## Core Design Principles

### 1. Channel as the Unit of Identity
The `AgentSession` key is `(workspace_id, channel_id)`, NOT `user_id`.

Every user in `#engineering` talks to the same agent, sees the same context, can pick up mid-thread. This is the fundamental inversion from all existing tools.

### 2. Multi-User Attribution
Every message in agent context is tagged with who said it:
```
[2026-06-25 14:32 @alice] deploy the new model to staging
[2026-06-25 14:33 @bob] actually wait, let's run tests first
[AGENT] Holding the deploy. @bob — can you share the test results in this thread?
```
Agent knows WHO said what, can direct follow-ups at individuals, memory writes include attribution.

### 3. File-Based Channel Config (OpenClaw-inspired)
Each channel gets a directory. Version-controllable, no UI required to get started:
```
channels/
  C01234ABC/             ← Slack channel_id
    CHANNEL.md           ← identity, purpose, tone for this channel
    TOOLS.md             ← which MCP servers are enabled
    MEMORY.md            ← curated facts (agent-written, not append-only)
    BUDGET.md            ← token limits (per-request, daily, monthly)
    skills/
      deploy-checklist.md
      oncall-runbook.md
      pr-review.md
```

### 4. Agent-Curated Memory (Letta-inspired inner loop)
After responding, the agent gets one internal turn to decide what's worth persisting to `MEMORY.md`. It uses `memory_append` and `memory_replace` tools. Memory stays clean because the agent curates it — not a dumb append-only log.

### 5. Skill Auto-Creation (Hermes-inspired)
After any task requiring 5+ tool calls, the agent writes a `SKILL.md` capturing what it learned. Next time a similar task comes up, the skill is loaded into context automatically. This is how institutional channel knowledge accumulates over time.

### 6. Agent-Managed Ambient Mode (Hermes crons)
Agent can call a `schedule_task(cron, description)` tool to create its own monitoring jobs. A heartbeat evaluator runs each cron, dumps recent channel state to the LLM, and asks: "anything worth surfacing?" If yes, it posts proactively.

### 7. MCP-Native Tool Access
All external tools exposed via MCP protocol. Admins list allowed MCP servers per channel in `TOOLS.md`. Portable, standard, Slack itself is now an MCP client — we align with the ecosystem.

### 8. LLM-Agnostic via LiteLLM
Default to Claude (Anthropic). Swap to GPT-4o, Gemini, or local Ollama via one config line. No LLM-vendor lock-in.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Slack Events                          │
│           Socket Mode (dev) / Events API (prod)              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Bolt App   │   async Python
                    │  Gateway    │
                    └──────┬──────┘
                           │
               ┌───────────▼───────────┐
               │    Channel Router      │
               │  (workspace_id +       │
               │   channel_id)          │
               │   → AgentSession       │
               └───────────┬───────────┘
                           │
          ┌────────────────▼──────────────────┐
          │          Context Assembler          │
          │  CHANNEL.md  (identity/purpose)     │
          │  MEMORY.md   (curated facts)        │
          │  SKILLS/*.md (loaded on demand)     │
          │  Recent msgs (sliding window N=50)  │
          │  User map    (display names)        │
          └────────────────┬──────────────────┘
                           │
          ┌────────────────▼──────────────────┐
          │           Agent Loop               │
          │   ReAct + tool-use                 │
          │   ├── Tool Registry (MCP)          │
          │   ├── Heartbeat (multi-step ok)    │
          │   └── Stream reply → Slack thread  │
          └──────┬─────────────────────┬───────┘
                 │                     │
      ┌──────────▼──────────┐ ┌────────▼──────────────┐
      │   Memory Writer      │ │   Skill Evaluator      │
      │  Inner loop turn:    │ │  ≥5 tool calls?        │
      │  agent decides what  │ │  → write SKILL.md      │
      │  to write to         │ │  curator runs weekly   │
      │  MEMORY.md           │ └────────────────────────┘
      │  SQLite FTS5 index   │
      └──────────────────────┘
                 │
      ┌──────────▼──────────┐
      │   Ambient Engine     │   background process
      │  Per-channel crons   │
      │  Heartbeat LLM eval  │
      │  Stale thread scan   │
      │  Proactive Slack post│
      └──────────────────────┘
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Bot framework** | Slack Bolt (Python, async) | Best-documented, async/socket mode, Python ML ecosystem |
| **LLM routing** | LiteLLM | One interface for Claude/GPT/Gemini/Ollama, no vendor lock-in |
| **Primary memory** | SQLite + FTS5 (per channel) | No external deps, portable, WAL mode handles concurrent writes, Hermes-proven |
| **Semantic recall** | Mem0 (Phase 2) | ~80ms, fits on top of SQLite, ships fast |
| **Tool execution** | MCP protocol | Standard, Slack-native, hundreds of existing MCP servers |
| **Ambient tasks** | APScheduler → Temporal (Phase 3+) | APScheduler for MVP, Temporal for durability at scale |
| **Config** | TOML files + flat Markdown per channel | Human-readable, version-controllable, no UI needed to start |
| **Admin UI** | Next.js (Phase 4) | Channel config, tool access controls, token budgets |
| **Governance** | Microsoft Agent Governance Toolkit (MIT) | Don't build RBAC from scratch |

---

## Memory Architecture (layered)

Borrowed from both OpenClaw and Hermes, adapted for multi-user channels:

```
Layer 1: Context Window
  └── Last N=50 messages with user attribution
  └── CHANNEL.md + active SKILL.md files
  └── MEMORY.md (curated facts, always in context)

Layer 2: Session Store (SQLite per channel)
  └── Full message history with user_id, timestamp, thread_ts
  └── Tool call records (what ran, what it returned)
  └── FTS5 index for instant keyword lookup

Layer 3: Semantic Search (Mem0, Phase 2)
  └── Embeddings over important decisions/facts
  └── Used for "what did we decide about X last month?"
  └── Namespace = channel_id (isolated per channel)

Layer 4: Skill Library (per channel)
  └── SKILL.md files in channels/<id>/skills/
  └── Loaded into context when relevant (semantic match on task)
  └── Auto-created by agent after complex tasks
  └── Curated weekly (stale → archived after 30d unused)
```

---

## Agent Loop Detail

```python
# Pseudocode — actual implementation in agent/loop.py

async def run_agent_loop(channel_id, workspace_id, message, user_id):
    session = get_or_create_session(workspace_id, channel_id)
    
    # 1. Assemble context
    context = assemble_context(
        channel_config=load_channel_config(channel_id),
        memory=load_memory_md(channel_id),
        skills=load_relevant_skills(channel_id, message),
        recent_messages=get_recent_messages(channel_id, n=50),
        user_map=get_workspace_users(workspace_id),
    )
    
    # 2. Run ReAct loop
    tool_call_count = 0
    while True:
        response = await llm.complete(context, tools=get_channel_tools(channel_id))
        
        if response.is_tool_call:
            result = await execute_mcp_tool(response.tool, channel_id)
            context.add_tool_result(result)
            tool_call_count += 1
        else:
            break  # final answer
    
    # 3. Stream reply to Slack
    await slack.post_message(channel_id, response.text, thread_ts=message.thread_ts)
    
    # 4. Inner loop: memory curation (Letta-inspired)
    await memory_curation_turn(channel_id, context, response)
    
    # 5. Skill creation check (Hermes-inspired)
    if tool_call_count >= 5:
        await maybe_create_skill(channel_id, context, response)
    
    # 6. Persist to SQLite
    await persist_turn(channel_id, user_id, message, response, tool_call_count)
```

---

## Channel Config Files

### CHANNEL.md
```markdown
# Engineering Channel

You are the engineering team's AI teammate in #engineering.

## Purpose
Help the team with deployments, code reviews, incident response, and architecture decisions.

## Tone
Technical, direct, concise. Use code blocks liberally. Ask clarifying questions before big actions.

## What you know about this team
- We use GitHub, Linear, Datadog, and AWS
- Deployments happen via GitHub Actions
- On-call rotation: alice (this week), bob (next week)
- We do not deploy on Fridays
```

### TOOLS.md
```toml
[[mcp_server]]
name = "github"
url = "mcp://github.internal:3000"
allowed_tools = ["list_prs", "get_file", "create_comment"]

[[mcp_server]]
name = "linear"
url = "mcp://linear.internal:3001"
allowed_tools = ["list_issues", "create_issue", "update_status"]

[[mcp_server]]
name = "web_search"
url = "mcp://search:3002"
allowed_tools = ["search"]
```

### BUDGET.md
```toml
[limits]
max_tokens_per_request = 50000
max_tokens_per_day = 500000
max_tokens_per_month = 5000000
alert_at_percent = 80
```

---

## Ambient Mode Design

The heartbeat evaluator runs on a per-channel cron. It assembles an observation dump and asks the LLM if anything is worth surfacing.

```python
# Pseudocode — ambient/heartbeat.py

async def run_heartbeat(channel_id):
    observation = {
        "recent_messages": get_messages_since_last_heartbeat(channel_id),
        "open_tasks": get_open_items(channel_id),          # from Linear/GitHub
        "stale_threads": get_threads_no_reply_48h(channel_id),
        "pending_decisions": extract_pending_decisions(channel_id),
    }
    
    prompt = f"""
    You are monitoring the #{channel_name} channel.
    Here's what's happened since your last check:
    
    {format_observation(observation)}
    
    Should you post anything proactively? Only post if there's genuine value:
    - A stale thread that needs follow-up
    - A deadline approaching
    - An unresolved question that was forgotten
    - A conflict or risk you spotted
    
    If nothing is worth surfacing, respond with SILENT.
    """
    
    response = await llm.complete(prompt)
    if response.text != "SILENT":
        await slack.post_message(channel_id, response.text)
```

Agent creates its own crons via tool:
```python
# Agent calls this tool during a conversation
schedule_task(
    cron="0 9 * * 1",          # every Monday 9am
    description="Weekly standup prep: summarize last week's threads and open items"
)
```

---

## Skill Lifecycle (Hermes-inspired)

```
Task completes with ≥5 tool calls
         ↓
Agent writes skills/<slug>.md with YAML frontmatter
         ↓
Skill is available for future sessions (semantic match on task description)
         ↓
         ├── Used regularly → stays active
         ├── Not used 30 days → marked stale
         └── Not used 90 days → archived (kept but not auto-loaded)

Weekly curator run:
  - Merges overlapping skills
  - Patches outdated instructions
  - Promotes stale skills if they get used again
```

### SKILL.md format (from Hermes):
```markdown
---
name: deploy-to-staging
description: Deploy a service to the staging environment via GitHub Actions
created: 2026-06-25
tool_calls_in_session: 7
uses: 0
last_used: null
status: active
---

## When to use this
When someone asks to deploy a service to staging.

## Steps
1. Check if there's an open PR with the changes (use `github:list_prs`)
2. Verify CI is passing on the branch
3. Trigger the `deploy-staging` workflow via `github:trigger_workflow`
4. Monitor the deployment log for 2 minutes
5. Post the staging URL back to the channel

## Known gotchas
- We don't deploy on Fridays (check day of week first)
- Always confirm with the person who asked before triggering
```

---

## Phase Build Plan

### Phase 1 — Reactive channel teammate (target: 2–3 weeks)
- [ ] Project scaffold: Python, Bolt async, pyproject.toml
- [ ] Socket Mode Slack connection
- [ ] Channel router: `(workspace_id, channel_id)` → `AgentSession`
- [ ] Context assembler: CHANNEL.md + MEMORY.md + recent messages with attribution
- [ ] Agent loop: ReAct + tool-use via LiteLLM
- [ ] 3 built-in MCP tools: web search, Python code runner, file reader
- [ ] SQLite + FTS5 session store per channel
- [ ] Multi-user attribution in context window
- [ ] File-based channel config (CHANNEL.md, TOOLS.md, BUDGET.md)
- [ ] Basic token budget enforcement

**Milestone:** `@agent explain the last PR that was deployed` works in a Slack channel, with shared context across all users.

### Phase 2 — Memory + Skills (target: +2 weeks)
- [ ] Letta inner loop: memory curation turn after each response
- [ ] `memory_append` and `memory_replace` agent tools
- [ ] Hermes-style skill auto-creation (≥5 tool calls → write SKILL.md)
- [ ] Skill loader: semantic match skill to incoming task
- [ ] Skill curator (weekly background job)
- [ ] Mem0 integration for semantic recall layer

**Milestone:** Agent remembers team conventions across sessions without being told twice. Skill library grows automatically.

### Phase 3 — Ambient mode (target: +2 weeks)
- [ ] Heartbeat evaluator (APScheduler, per channel)
- [ ] Stale thread detection
- [ ] `schedule_task` tool (agent creates its own crons)
- [ ] Observation dump builder
- [ ] SILENT / post decision logic
- [ ] Temporal integration for durable task orchestration (optional at this stage)

**Milestone:** Agent proactively surfaces a forgotten thread or approaching deadline without being tagged.

### Phase 4 — Governance + Admin UI (target: +2 weeks)
- [ ] Per-channel audit log (who asked what, which tools ran, tokens spent)
- [ ] Hard token budget enforcement (reject request if over limit)
- [ ] Admin web UI: channel config, tool access controls, budget view
- [ ] Microsoft Agent Governance Toolkit integration for RBAC
- [ ] Channel isolation tests (agent A cannot read channel B memory)

**Milestone:** Enterprise admin can configure and audit every channel's agent from a web UI.

### Phase 5 — Multi-platform + ecosystem (ongoing)
- [ ] Discord adapter (same channel router, different event source)
- [ ] Microsoft Teams adapter
- [ ] Contribute Slack adapter improvements to OpenClaw ecosystem
- [ ] MCP server registry UI (browse and enable community MCP servers)
- [ ] Public hosted version (tagopen.ai or similar)

---

## What NOT to Build (at least not yet)

- ❌ Per-user memory (personal assistant mode) — stay focused on channel-native
- ❌ Custom LLM fine-tuning — use existing models, stay model-agnostic
- ❌ Voice/video — Slack only for now
- ❌ Own vector DB — use Mem0 abstraction, don't build RAG infrastructure
- ❌ Custom MCP servers — support the protocol, let community build servers
- ❌ Real-time streaming UI — Slack's threading model is enough for MVP

---

## Key References

- [Claude Tag announcement — Anthropic](https://www.anthropic.com/news/introducing-claude-tag)
- [Claude Tag technical architecture — explainx.ai](https://www.explainx.ai/blog/claude-tag-slack-team-ai-collaboration-guide-2026)
- [OpenClaw docs — agent loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw docs — multi-agent routing](https://docs.openclaw.ai/concepts/multi-agent)
- [OpenClaw gateway deep dive](https://practiceoverflow.substack.com/p/deep-dive-into-the-openclaw-gateway)
- [Hermes Agent 5-pillar architecture](https://www.mindstudio.ai/blog/hermes-agent-5-pillar-architecture-memory-skills-soul-crons)
- [Hermes Agent self-improving loop](https://mranand.substack.com/p/inside-hermes-agent-how-a-self-improving)
- [Letta agent loop rearchitecture](https://www.letta.com/blog/letta-v1-agent)
- [Ambient agents — Temporal](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)
- [Heartbeat pattern for proactive agents](https://www.mindstudio.ai/blog/agentic-os-heartbeat-pattern-proactive-ai-agent)
- [Mem0 vs Zep vs Letta comparison](https://dev.to/agdex_ai/ai-agent-memory-in-2026-mem0-vs-zep-vs-letta-vs-cognee-a-practical-guide-cfa)
- [Slack as agentic OS + MCP](https://aiautomationglobal.com/blog/slack-ai-agentic-os-mcp-30-features-2026)
- [Agent Governance Toolkit — Microsoft](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)

---

## Open Questions (decide before building)

1. **Name** — TagOpen? Channelmate? Copal? Teammate? Needs a GitHub repo name.
2. **Python vs Node** — Python chosen for ML ecosystem alignment, but OpenClaw is Node/TS with way more community. Worth revisiting if community contribution matters early.
3. **Hosting model** — self-host only for MVP, or offer a hosted SaaS version early for distribution?
4. **Thread vs channel** — should ambient posts start new threads or post in main channel? (UX decision)
5. **Memory consent** — should users be able to opt out of having their messages stored in channel memory?
6. **Skill sharing** — should skills be per-channel only, or shareable across channels in the same workspace?
