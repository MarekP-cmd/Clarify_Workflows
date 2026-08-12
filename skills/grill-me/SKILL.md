---
name: grill-me
description: Start an explicit, relentless interview that sharpens a plan, product idea, design, or decision. Use when the user asks to be grilled, says “grill me,” or explicitly invokes this skill; do not start the interview merely because a plan is mentioned. Treat “grill me off” and “grill me disabled” as commands that suppress this skill for the current conversation, and “grill me on” or “grill me enabled” as commands that re-enable it.
---

# Grill Me

## Control switch

Treat these exact phrases as control commands, not as requests to begin an interview:

- `grill me off`
- `grill me disabled`

When either command appears, mark Grill Me disabled for the rest of the current conversation, acknowledge the change briefly, and do not activate `grilling` on that turn or on later turns in the same conversation. If the user invokes `$grill-me` while disabled, state that it is off and wait for an enable command.

Re-enable it when the user says either:

- `grill me on`
- `grill me enabled`

This switch is conversation-local. Do not claim that it changes the account-wide ChatGPT Skills setting or persists into every future conversation.

Activate the companion `grilling` skill and conduct that workflow in the current ChatGPT conversation. Do not issue a literal `/grilling` slash command.

Ask the first round of design-tree questions, then wait for the user's answers. Do not implement or act on the plan until the user confirms that a shared understanding has been reached.
