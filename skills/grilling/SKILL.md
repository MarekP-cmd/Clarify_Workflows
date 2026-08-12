---
name: grilling
description: Conduct a relentless, round-based interview that stress-tests a plan, product idea, design, or decision. Use when the user explicitly asks to be grilled or invokes $grilling/$grill-me, or when another skill routes to this workflow. Honor “grill me off” and “grill me disabled” as conversation-local disable commands, and “grill me on” or “grill me enabled” as re-enable commands.
---

# Grilling

## Honor the Grill Me switch

Before asking questions, check the conversation's latest Grill Me control command. If the user says `grill me off` or `grill me disabled`, acknowledge it briefly and do not conduct an interview for the rest of that conversation. If the user says `grill me on` or `grill me enabled`, clear the conversation-local disabled state and resume normal behavior. Do not claim that this changes an account-wide ChatGPT setting or persists into every future conversation.

Interview the user relentlessly until you reach a shared understanding. Map the subject as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled—the questions you can ask now without guessing at answers the user has not given. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format each question like this:

```
❓ **Q1** - **<question title>**: <question body, possibly multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round, the user's answers reshape the tree. Settled decisions push the frontier outward and unblock questions that depended on them. A question whose answer depends on another question still open in this round belongs to a later round, not this one.

Find facts yourself rather than asking the user for facts that can be retrieved. Use the available conversation context and tools (for example, filesystem inspection, documentation, or web research when appropriate). If a fact lookup would benefit from a delegated agent and delegation is available, delegate it; otherwise perform the lookup yourself and continue with independent frontier questions while it runs.

The session is done when the frontier is empty: every branch of the design tree has been visited and nothing material remains silently assumed. Do not implement, commit, send, or otherwise act on the plan until the user confirms that the shared understanding is complete.
