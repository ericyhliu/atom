# atom

A minimal CLI agent harness on top of [together.ai](https://together.ai).
Zero dependencies, runs directly on Node 24 (no build step). The goal is to
learn harness engineering by building a mini [opencode](https://opencode.ai)
from the ground up.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ericyhliu/atom/main/install.sh | sh
export TOGETHER_API_KEY=your_key
atom
```

Single binary, no runtime needed. Re-run the installer to upgrade.

## Develop

```sh
cp .env.example .env      # add your TOGETHER_API_KEY
npm start                 # REPL
npm start -- "list the files here"   # one-shot
npm run build             # binaries for all platforms into dist/ (needs bun)
```

## Release

Bump `version` in `package.json`, then tag it — CI builds the binaries and
publishes a GitHub Release that `install.sh` picks up:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## What a harness is

The model is a function `messages -> message`. It cannot read files, run
commands, or remember anything. The *harness* is everything wrapped around
that function to turn it into an agent:

```
              ┌──────────────────────────────────────────┐
  user ──────>│ cli.ts        REPL, rendering, /commands  │
              │   │                                       │
              │   ▼                                       │
              │ agent.ts      THE LOOP                    │
              │   │  messages[] ─> provider.chat() ─┐     │
              │   │      ▲                          │     │
              │   │      │ tool results     tool_calls?   │
              │   │      └──── tools/ <───────────┘ │     │
              │   │                          no ────┼──> text to user
              │   ▼                                       │
              │ provider.ts   HTTP to together.ai         │
              └──────────────────────────────────────────┘
```

| file | responsibility |
|---|---|
| `src/provider.ts` | The only file that knows the wire format. Types mirror the OpenAI-compatible `/chat/completions` API. |
| `src/agent.ts` | The loop: append user msg → call model → if `tool_calls`, run them, append `role:"tool"` results, call again → else return. |
| `src/tools/` | Each tool = name + description + JSON schema + `execute()`. Always returns a string; errors are returned as text so the model can recover. |
| `src/prompt.ts` | System prompt. Injects cwd/platform so the model has situational awareness. |
| `src/cli.ts` | Terminal front end. Owns stdin/stdout, renders `AgentEvents`, asks y/N before dangerous tools. |

### Harness decisions already baked in (and why)

- **Message history is the state.** `agent.messages` is the whole session.
  `/history` dumps it — read it after a run to see exactly what the model saw.
- **Tool results are strings, always.** A thrown error becomes `error: ...`
  in the tool message. The model sees it and self-corrects instead of the
  loop crashing.
- **Output is capped** (`MAX_OUTPUT_CHARS`). One `cat` of a big file must
  not consume the context window.
- **`maxSteps` safety valve.** Bounds how many model calls one user turn can
  trigger, so a confused model can't loop forever on your API bill.
- **Dangerous tools go through `confirm()`.** The harness — not the model —
  decides what actually executes. This is the seed of a permission system.
- **The loop emits events; it doesn't print.** `AgentEvents` is the seam
  between the engine and the UI. Swapping the REPL for a TUI or a server
  means changing `cli.ts` only.

## Roadmap toward mini-opencode

Roughly in the order each one becomes painful without it:

1. **Streaming** — SSE from `/chat/completions`, render tokens as they arrive.
2. **Edit tool** — `edit_file(path, old, new)` with exact-match replacement;
   the model reads first, then edits.
3. **Permissions** — per-tool allow/deny rules, "always allow" for a session,
   sandboxed bash.
4. **Sessions** — persist `messages` to `.atom/sessions/*.json`, `/resume`.
5. **Context management** — token counting, compaction/summarization when
   nearing the window.
6. **Project context** — auto-load an `AGENTS.md`, inject `git status`.
7. **Provider abstraction** — a second provider behind the same
   `chat()` interface (Anthropic, OpenAI, local).
8. **Subagents** — a tool whose `execute()` spins up a fresh `Agent`.
9. **TUI** — replace readline with a proper terminal UI.
