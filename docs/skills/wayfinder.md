# ChatGPT `wayfinder` skill

Clarity Workflows versions the adapted ChatGPT `wayfinder` skill under [`skills/wayfinder/`](../../skills/wayfinder/). It turns a large, uncertain effort into a decision map, then resolves the route one decision ticket at a time.

## ChatGPT adaptation

The upstream workflow assumed a slash-command setup, a specific issue-tracker environment, and automatic issue mutation. The ChatGPT version removes those assumptions:

- It drafts the map and ticket set as Markdown in the conversation or local project files by default.
- It invokes the installed `grilling` workflow when available; otherwise it uses a concise structured round rather than a literal slash command.
- It uses available web, filesystem, Library, connected-app, and delegation tools only when they are actually available.
- It treats tracker labels, child issues, assignments, blocking edges, comments, and closures as optional publication operations—not facts to invent.
- It publishes only after the user explicitly requests publication and confirms the exact repository or tracker, relevant permissions, and supported label/dependency operations.
- It preserves the human-in-the-loop boundary: the agent may recommend decisions, but it never answers the human's side of a grilling ticket for them.

## Workflow model

1. Name the destination before mapping the effort.
2. Map the breadth-first frontier and distinguish precise tickets from unresolved fog of war.
3. Draft the canonical map and decision tickets; wire dependencies only when the confirmed tracker supports them.
4. Resolve at most one non-research ticket per session, recording the answer in the draft.
5. Graduate newly specified decisions and stop when the route is clear.

Ticket types are Research (AFK), Prototype (HITL), Grilling (HITL), and Task (HITL or AFK). A research ticket may use available tools or parallel delegation; a grilling ticket requires a live exchange with the human.

## Publication boundary

Local Markdown is not represented as synchronized GitHub state. If the user requests publication, the exact target and available tracker operations must be confirmed first. When those details or write capabilities are missing, return the finalized Markdown and a short publication checklist instead of creating a guessed issue, label, assignment, dependency, or context pointer.

## Source of truth

- Skill instructions: [`skills/wayfinder/SKILL.md`](../../skills/wayfinder/SKILL.md)
- Installed companion workflow: [`skills/grilling/SKILL.md`](../../skills/grilling/SKILL.md)
- Existing Clarity skill: [`skills/clarity-workflows/SKILL.md`](../../skills/clarity-workflows/SKILL.md)
- Current project baseline: Clarity Workflows v0.6.0, Chunk 4

The skill is source-controlled with Clarity Workflows and is not stored as ordinary SQLite workspace data.
