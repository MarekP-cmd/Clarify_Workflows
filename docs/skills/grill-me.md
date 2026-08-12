# ChatGPT `grill-me` and `grilling` skills

Clarity Workflows versions the adapted ChatGPT skills that support deliberate plan and design review. They are kept under `skills/` so the skill instructions remain source-controlled with the application; they are not workspace graph data and are not stored in the SQLite Core.

## `grill-me`

`grill-me` is the explicit entry point. It routes the current conversation to the companion `grilling` workflow, which interviews the operator in rounds until the plan or design has no unresolved decision branches.

It must not begin merely because a plan is mentioned. The operator can invoke it explicitly with `$grill-me` or by asking to be grilled.

## Conversation-local control switch

These exact commands control the workflow:

| Command | Effect |
| --- | --- |
| `grill me off` | Disable Grill Me for the rest of the current conversation. |
| `grill me disabled` | Same disable behavior. |
| `grill me on` | Re-enable Grill Me in the current conversation. |
| `grill me enabled` | Same re-enable behavior. |

While disabled, the skill must acknowledge the command briefly and must not start an interview, including when `$grill-me` or `$grilling` is subsequently invoked. The switch is conversation-local: a skill instruction cannot change ChatGPT's account-wide Skills setting or persist mutable state across every future conversation.

## `grilling`

The companion workflow:

1. Maps the subject as a decision tree.
2. Computes the current frontier—the questions whose prerequisites are settled.
3. Asks the whole frontier in one numbered round and recommends an answer for each question.
4. Waits for the operator's answers before advancing the tree.
5. Retrieves factual information with available tools instead of asking the operator for facts that can be looked up.
6. Stops when every material branch has been visited and waits for confirmation before implementing or otherwise acting on the plan.

Question format:

```text
❓ **Q1** - **<question title>**: <question body>

➡️ <recommended answer>
```

## Source of truth

- Entry skill: [`skills/grill-me/SKILL.md`](../../skills/grill-me/SKILL.md)
- Companion workflow: [`skills/grilling/SKILL.md`](../../skills/grilling/SKILL.md)
- Clarity Workflows skill: [`skills/clarity-workflows/SKILL.md`](../../skills/clarity-workflows/SKILL.md)

The current repository baseline is Clarity Workflows v0.6.0, Chunk 4. Future skill changes should be reviewed alongside the application handoff and release reports.
