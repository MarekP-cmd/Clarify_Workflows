# ChatGPT `to-spec` skill

Clarity Workflows versions the adapted ChatGPT `to-spec` skill under [`skills/to-spec/`](../../skills/to-spec/). It turns the existing conversation and repository context into a structured implementation specification without starting a broad requirements interview.

## ChatGPT adaptation

The upstream skill assumed a slash-command setup script and automatic publication to an issue tracker. The ChatGPT version removes those assumptions:

- It uses the current conversation, repository tools, and available documentation.
- It retrieves facts that can be looked up and records unresolved decisions as assumptions or open questions.
- It recommends the highest practical testing seam and asks at most one focused clarification when the seam is materially ambiguous.
- It presents the Markdown specification in the conversation before any external write.
- It creates a GitHub issue or other project record only after the user explicitly requests publication and confirms the target repository and label vocabulary.
- It never assumes a `ready-for-agent` label or a particular issue tracker.

## Specification sections

Every draft contains:

1. Problem Statement
2. Solution
3. User Stories
4. Implementation Decisions
5. Testing Decisions
6. Out of Scope
7. Further Notes

Implementation decisions are expressed without brittle file paths or unnecessary code snippets. Testing decisions focus on externally observable behavior and use the highest justified seam.

## Source of truth

- Skill instructions: [`skills/to-spec/SKILL.md`](../../skills/to-spec/SKILL.md)
- Existing Clarity skill: [`skills/clarity-workflows/SKILL.md`](../../skills/clarity-workflows/SKILL.md)
- Current project baseline: Clarity Workflows v0.6.0, Chunk 4

The skill is source-controlled with Clarity Workflows and is not stored as ordinary SQLite workspace data.
