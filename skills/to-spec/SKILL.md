---
name: to-spec
description: Turn the current conversation and codebase context into a structured implementation specification. Use when the user explicitly invokes $to-spec or asks to convert a discussion, feature idea, or design into a spec; do not conduct a broad requirements interview.
---

# To Spec

Synthesize what is already known into a precise implementation specification. Do not conduct a broad requirements interview. Use the current conversation, the repository, and available documentation/tools. Retrieve facts that can be looked up; record genuinely unresolved decisions as assumptions or open questions rather than inventing answers.

## Process

1. Explore the repository to understand the current state of the codebase, if it is available. Use the project's domain glossary and respect applicable architecture decisions and handoff documents.

2. Identify the highest practical testing seam for the feature. Prefer an existing seam over a new one and keep the number of cross-codebase seams as small as possible—ideally one. State the recommended seam and its trade-offs in the specification. Ask one focused clarification only when the seam choice is materially ambiguous; do not turn the task into an interview.

3. Write the specification using the template below. Distinguish confirmed decisions, inferred constraints, assumptions, and open questions.

4. Present the draft specification in the current conversation first. Do not create an issue, pull request, commit, or other external record automatically.

5. Publish only after the user explicitly asks for publication and confirms the target repository or issue tracker. Use the connected GitHub or project-management tool when available. Never assume a repository, issue label, or `ready-for-agent` vocabulary. If the target or write capability is unavailable, provide the finalized Markdown for copy-and-paste instead.

<spec-template>

## Problem Statement

Describe the problem from the user's perspective.

## Solution

Describe the proposed solution from the user's perspective.

## User Stories

Provide a numbered list of user stories. Each story uses this form:

1. As an <actor>, I want a <feature>, so that <benefit>

Make the list extensive enough to cover the feature's meaningful behavior, failure modes, review boundaries, and operational needs.

## Implementation Decisions

List the decisions that shape implementation, including:

- modules to build or modify;
- interfaces and contracts;
- technical clarifications;
- architecture decisions;
- schema or data changes;
- API behavior;
- user interactions;
- provenance, approval, security, or trust boundaries.

Do not include specific file paths or code snippets because they can become stale. If a prototype contains a decision that prose cannot express precisely, include only the decision-rich state machine, reducer, schema, or type shape and identify it as prototype-derived.

## Testing Decisions

Describe what makes a good test, focusing on externally observable behavior rather than implementation details. Identify the modules or boundaries to test and relevant prior test patterns in the codebase. Include appropriate white-box, black-box, gray-box, integration, browser, or contract coverage only when justified by the feature.

## Out of Scope

State what this specification deliberately does not include.

## Further Notes

Record assumptions, risks, dependencies, migration concerns, unresolved questions, and the recommended next step.

</spec-template>
