# Clarity Workflows — Visual Design System

**Document status:** Proposed baseline  
**Version:** 0.1.0  
**Date:** 2026-08-12  
**Applies to:** Chunk 5 and later  
**Product boundary:** Clarity Workflows desktop application and its future shared UI surfaces

## 1. Purpose

This document translates the most useful, platform-independent parts of Apple's design and development philosophy into a Clarity-specific visual and interaction system.

Clarity should feel calm, precise, responsive, and carefully made. It should make complex AI-assisted workflows understandable without making the user feel that the system is hiding its complexity or taking control away from them.

This is an Apple-inspired system, not an attempt to copy Apple's interface, trademarks, proprietary assets, or platform-specific APIs.

## 2. Design north star

> Clarity gives people a beautiful, direct, and trustworthy workbench for composing, inspecting, and controlling evidence-grounded workflows.

The interface must help the user answer three questions at every important moment:

1. Where am I?
2. What can I do here?
3. What will happen next?

If the interface cannot answer those questions, the problem is structural before it is decorative.

## 3. Foundational principles

### 3.1 Purpose

Every visible element must serve the user's workflow. A control, panel, animation, badge, or decoration earns its place by improving understanding, action, orientation, safety, or recovery.

### 3.2 Agency

The human remains in control of workflow structure and consequential actions.

- Dragging, editing, previewing, undoing, and versioning are direct actions.
- AI suggestions enter as drafts or proposals.
- The interface never implies that a proposal is already approved.
- Destructive actions are reversible where possible and confirmed when necessary.

### 3.3 Responsibility

Clarity must be honest about privacy, provenance, capability, uncertainty, and failure.

- The interface explains what data is being used and where it may go.
- Trust status is visible without overstating certainty.
- Missing, stale, changed, unsupported, or failed content is not presented as valid.
- Approval is represented as a real human boundary, not as a confidence score.

### 3.4 Familiarity

Use established interaction conventions for common actions: select, drag, connect, edit, search, undo, redo, save, preview, publish, archive, and restore.

Novelty belongs in Clarity's workflow concepts, not in basic interaction mechanics.

### 3.5 Flexibility

The same workflow should remain understandable across window sizes, input methods, display scales, light and dark appearance, larger text, and different levels of user expertise.

### 3.6 Simplicity

Simplicity means reducing friction, not hiding capability. Show the essential structure first and reveal advanced configuration when it becomes relevant.

### 3.7 Craft

Typography, alignment, hit areas, animation, loading states, error states, keyboard behavior, and performance are part of the product—not finishing touches after the product is built.

### 3.8 Delight

Delight should come from confidence and flow: a connection snaps into place, an invalid action explains itself, an undo restores the previous state, and a complex workflow becomes readable at a glance.

Avoid decorative effects that compete with evidence, structure, or user attention.

## 4. Visual character

Clarity's visual character is:

- **Clear:** hierarchy and affordances are immediately legible.
- **Calm:** neutral surfaces and restrained decoration keep attention on the workflow.
- **Spatial:** the canvas communicates relationships and causality.
- **Precise:** alignment, spacing, ports, edges, and state indicators are consistent.
- **Trustworthy:** visual treatment distinguishes source material, AI proposals, staged outputs, and approved results.
- **Warm but professional:** the interface may have personality, but it must remain suitable for serious research and coding work.

The system should feel refined without becoming glossy, ornamental, or visually noisy.

## 5. Design tokens

All UI styling must use semantic tokens. Components must not scatter raw colors, arbitrary spacing values, or one-off shadow definitions through the codebase.

The values below are a provisional starting point for the first visual prototype. Token names are normative; numeric values remain subject to visual validation.

### 5.1 Color roles

| Token | Purpose | Light starting value | Dark starting value |
|---|---|---:|---:|
| `--clr-color-canvas` | Main application background | `#F5F6F8` | `#111315` |
| `--clr-color-surface` | Primary panel and card surface | `#FFFFFF` | `#1A1D20` |
| `--clr-color-surface-raised` | Floating or selected surface | `#FFFFFF` | `#22262A` |
| `--clr-color-surface-subtle` | Quiet grouping surface | `#EEF0F3` | `#171A1D` |
| `--clr-color-border` | Structural separator | `#DDE1E6` | `#343A40` |
| `--clr-color-border-strong` | Focused or emphasized separator | `#B9C0C9` | `#59616A` |
| `--clr-color-text-primary` | Main text | `#16191D` | `#F5F7F9` |
| `--clr-color-text-secondary` | Supporting text | `#656D77` | `#AEB6C0` |
| `--clr-color-text-tertiary` | Metadata and hints | `#87909B` | `#7E8994` |
| `--clr-color-accent` | Primary Clarity action and selection | `#2563EB` | `#6EA0FF` |
| `--clr-color-focus` | Keyboard and accessibility focus | `#0A84FF` | `#78B5FF` |
| `--clr-color-success` | Valid or approved state | `#2E8B57` | `#61C58B` |
| `--clr-color-warning` | Attention or pending state | `#A96F12` | `#E7B65D` |
| `--clr-color-danger` | Invalid, denied, or destructive state | `#C24141` | `#FF8585` |
| `--clr-color-info` | Informational state | `#4777A8` | `#8FC2F4` |

Color communicates meaning but never carries meaning alone. Pair status color with text, iconography, shape, or pattern.

### 5.2 Trust and workflow-state roles

These are semantic roles, not merely colors:

| State | Meaning | Required visual treatment |
|---|---|---|
| `untrusted` | Imported or external content not yet admitted as evidence | Neutral treatment plus explicit trust label |
| `retrieved` | Exact content admitted from a managed source or search result | Evidence marker and citation identity |
| `proposal` | AI- or system-generated suggestion | Distinct proposal marker; never styled as final |
| `staged` | Candidate output awaiting review or approval | Review status and clear next action |
| `approved` | Human-approved durable result | Approval marker, revision identity, and provenance |
| `stale` | Based on an earlier revision or changed source | Warning treatment and refresh/review action |
| `failed` | Operation did not complete successfully | Error treatment, cause, and recovery path |

### 5.3 Typography

Use a system UI font stack or a properly licensed equivalent. Do not make SF Pro a required dependency for the cross-platform Electron product.

```css
--clr-font-sans: system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
--clr-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas,
  monospace;
```

| Token | Use | Starting size / line height |
|---|---|---:|
| `--clr-type-display` | App or workflow title | `24 / 30` |
| `--clr-type-heading` | Panel and section heading | `17 / 23` |
| `--clr-type-body` | Main interface text | `14 / 20` |
| `--clr-type-label` | Control labels and node metadata | `12 / 16` |
| `--clr-type-caption` | Secondary metadata | `11 / 15` |
| `--clr-type-code` | IDs, digests, schemas, and technical values | `12 / 17` |

Typography must remain readable when text grows, wraps, localizes, or appears beside icons and status indicators.

### 5.4 Spacing

Use a four-point base grid and an eight-point primary rhythm:

```text
4, 8, 12, 16, 20, 24, 32, 40, 48, 64
```

Use the closest semantic token rather than inventing a new value for each component.

### 5.5 Shape and depth

| Token | Starting value | Use |
|---|---:|---|
| `--clr-radius-small` | `6px` | compact controls and tags |
| `--clr-radius-medium` | `10px` | cards, nodes, inputs |
| `--clr-radius-large` | `16px` | panels and floating surfaces |
| `--clr-radius-pill` | `999px` | compact status or filter controls |

Depth should be communicated through surface contrast, borders, spacing, and limited shadow—not through heavy skeuomorphism.

Blur or translucent material may be used for a focused overlay or floating inspector, but it must not reduce text contrast or become the default treatment for every surface.

### 5.6 Motion

Motion is allowed when it explains one of these things:

- a state change;
- a relationship between objects;
- the result of a user action;
- the location of newly revealed content;
- progress or waiting.

Motion must be interruptible, brief, and disabled or reduced when the user requests reduced motion.

## 6. Application shell

The default desktop composition is a three-region workbench:

1. **Navigation sidebar:** projects, workflows, versions, and saved views.
2. **Primary canvas:** the workflow graph and its direct manipulation surface.
3. **Inspector / review panel:** configuration, validation, evidence, provenance, and preview details.

The shell also includes a restrained top toolbar for:

- current location and workflow name;
- draft/version status;
- undo and redo;
- validation status;
- plan preview;
- save, publish, archive, or restore actions where applicable.

The canvas is the primary workspace. Panels support the canvas; they must not make it feel like a form editor with a diagram attached.

### 6.1 Panel behavior

- Panels can collapse without losing work.
- The selected object remains visually anchored when the inspector opens.
- Advanced sections stay collapsed until relevant.
- The interface preserves panel state during ordinary navigation.
- Narrow windows collapse the inspector into an overlay or drawer.
- The app never hides the current workflow identity or revision status.

## 7. Workflow canvas

### 7.1 Canvas behavior

The canvas supports:

- pan;
- zoom;
- fit-to-workflow;
- optional subtle grid;
- snap-to-grid and alignment guides;
- multi-select;
- group and ungroup;
- duplicate;
- keyboard navigation;
- minimap for larger workflows;
- focus mode for a selected path or subgraph.

The canvas must remain usable when a workflow is sparse, dense, partially invalid, or still being composed.

### 7.2 Node anatomy

Every workflow node should have a consistent structure:

1. type icon or glyph;
2. concise human-readable title;
3. short purpose summary;
4. typed input and output ports;
5. status and trust indicator;
6. capability or policy indicator where relevant;
7. optional evidence, version, or provenance summary;
8. clear selected, focused, invalid, and disabled states.

The node should communicate what it does before the user opens the inspector.

### 7.3 Node families

The initial visual vocabulary should use meaningful workflow operations rather than low-level technical wrappers:

| Family | Example purpose | Visual emphasis |
|---|---|---|
| Source | reference a file, dataset, or managed artifact | origin and trust |
| Retrieval | search or select exact evidence | citation and query |
| Transformation | filter, combine, map, or format data | input/output type |
| Reasoning | synthesize, compare, challenge, or decide | proposal status |
| Gate | check evidence, capability, or policy | boundary and decision |
| Approval | request explicit human review | human action |
| Artifact | produce a report, dataset, code output, or export | provenance and digest |

The final list of node families is owned by the workflow-definition contract. The UI must not create a new family merely to accommodate a technical implementation detail.

## 8. Typed connections

A connection is a semantic data path, not a decorative line.

Every port declares:

- the kind of data it accepts or emits;
- whether the value is singular, optional, or a collection;
- whether provenance is required;
- whether the content is untrusted, retrieved, proposed, staged, or approved;
- which capabilities or policy checks apply.

Initial connection vocabulary:

| Connection type | Meaning |
|---|---|
| `source-reference` | identity of a managed source or artifact |
| `evidence` | bounded content with citation identity |
| `context` | admitted context supplied to a downstream operation |
| `proposal` | unapproved generated plan or candidate |
| `dataset` | digest-identified structured input |
| `approval` | explicit human decision bound to a revision |
| `artifact` | generated or transformed output with provenance |
| `control` | workflow sequencing or policy dependency without content transfer |

The UI should make connection types understandable through port labels, icons, line style, and inspector text. Color may reinforce a type but must not be the only signal.

Invalid connections should be rejected before persistence. During connection drawing, the interface should show compatible targets and explain incompatible targets in plain language.

## 9. Direct manipulation rules

### 9.1 Create

- Add nodes through a node library, command palette, or contextual canvas menu.
- Place the node at the pointer location or at a deterministic insertion point.
- Give the new node a useful default configuration without pretending it is complete.
- Focus the first required field only when doing so helps the user continue.

### 9.2 Connect

- Begin from a visible typed port.
- Highlight compatible ports while dragging.
- Show the resulting connection type before release.
- Reject incompatible targets with a concise reason.
- Preserve the workflow if the user cancels the gesture.

### 9.3 Select and inspect

- One click selects a node or edge.
- The inspector reflects the authoritative selected snapshot.
- Editing uses explicit commands and reports validation immediately.
- Multi-selection supports shared operations only when those operations are semantically safe.

### 9.4 Move and organize

- Moving a node changes layout, not workflow meaning.
- Connections remain attached during movement.
- Alignment and distribution tools preserve semantic relationships.
- Automatic layout is optional assistance and never silently changes node or edge semantics.

### 9.5 Undo and recovery

- User-visible editing commands are undoable where technically possible.
- Undo restores the prior valid or draft revision rather than silently deleting history.
- Destructive operations state what will be affected.
- The interface provides recovery instead of trapping the user in a failed state.

## 10. Progressive disclosure

The first view of a workflow should show:

- structure;
- node purpose;
- connection meaning;
- validation state;
- revision state;
- required next action.

The inspector may progressively reveal:

- detailed inputs and outputs;
- policy and capability declarations;
- source and citation details;
- migration information;
- advanced configuration;
- developer-oriented identifiers.

Technical detail is available, but it should not compete with the user's primary design task.

## 11. Workflow definition states

The Composer must distinguish definition lifecycle states:

| State | Meaning | User action |
|---|---|---|
| `draft` | editable working revision | edit, validate, preview |
| `valid` | draft passes static validation | preview, publish, or continue editing |
| `invalid` | draft contains one or more blocking errors | inspect and correct |
| `published` | immutable version available for use | clone or create a new revision |
| `archived` | intentionally removed from active selection | restore or permanently manage later |
| `stale` | based on an earlier contract or source revision | review migration or refresh |

The interface must not use one generic green/yellow/red indicator to represent all of these states.

## 12. Validation and feedback

Validation is part of composition, not a final surprise.

The Composer must identify:

- cycles where cycles are not allowed;
- unreachable nodes;
- missing required inputs;
- incompatible port types;
- unsupported capabilities;
- unbounded fan-out;
- invalid or missing version information;
- policy or approval requirements;
- stale references;
- duplicate or conflicting identifiers.

Each validation message should contain:

1. what is wrong;
2. where it is wrong;
3. why it matters;
4. the smallest useful next action.

Errors must be actionable and must not expose raw database errors, provider SDK errors, or stack traces to ordinary users.

## 13. Preview mode

The Composer must provide a deterministic, non-executing plan preview.

Preview should show:

- workflow version;
- ordered or dependency-aware steps;
- inputs and outputs;
- connection types;
- required capabilities;
- evidence requirements;
- gate locations;
- approval points;
- unresolved validation issues;
- what will not happen because execution is not being invoked.

Preview is an inspection surface. It must not call an AI provider, execute code, mutate authoritative graph state, or imply that approval has occurred.

## 14. Provenance and trust presentation

Provenance is a first-class visual property.

The interface should let the user inspect:

- source identity;
- origin type;
- extraction or retrieval revision;
- exact citation or passage identity;
- content digest where applicable;
- workflow and node revision;
- generated proposal relationship;
- approval identity and timestamp when approval exists.

Generated content must never visually masquerade as source material. Approved content must not be confused with merely staged content.

## 15. Interaction and state coding philosophy

### 15.1 Renderer as projection

The canvas and inspector render validated application snapshots. They do not write SQLite tables directly and do not become an alternative source of truth.

### 15.2 Commands and queries

User actions become typed commands, such as:

```text
CreateWorkflowDefinition
AddWorkflowNode
ConnectWorkflowPorts
UpdateNodeConfiguration
ValidateWorkflowDefinition
PreviewWorkflowPlan
PublishWorkflowDefinition
ArchiveWorkflowDefinition
RestoreWorkflowDefinition
```

Queries return bounded snapshots, validation results, or preview models. Raw storage rows, provider payloads, filesystem paths, and access tokens do not cross into the visual layer.

### 15.3 One owner per invariant

The Composer must ask the authoritative owner for:

- revision checks;
- graph validity;
- port compatibility;
- gate and approval semantics;
- provenance integrity;
- lifecycle transitions;
- capability policy.

The canvas, inspector, MCP adapter, and export/import path must not reimplement these rules independently.

### 15.4 Explicit state machines

The UI should model meaningful state explicitly rather than infer it from scattered booleans.

Examples include:

```text
Canvas: idle → selecting → dragging → connecting → validating → saved
Inspector: closed → loading → ready → dirty → validating → error
Definition: draft → valid → published → archived
Preview: unavailable → building → ready → stale → failed
```

Transitions must be validated and testable.

### 15.5 Deep components

A component should hide meaningful behavior, not merely wrap a `<div>` or rename a vendor component.

Examples of useful deep UI modules:

- `WorkflowCanvas`: spatial interaction, selection, layout, zoom, and edge gestures;
- `WorkflowNode`: node anatomy, port rendering, status, and accessibility;
- `WorkflowInspector`: schema-driven editing and validation presentation;
- `ValidationPanel`: grouping, ordering, navigation, and recovery actions;
- `PlanPreview`: deterministic rendering of the compiled workflow plan;
- `VersionControlBar`: lifecycle and revision actions;
- `CommandPalette`: discoverable access to valid actions.

## 16. Component ownership map

| Component | Owns | Must not own |
|---|---|---|
| App shell | layout regions and responsive panel behavior | workflow validity or persistence |
| Navigation sidebar | project/workflow navigation presentation | direct database queries |
| Canvas | spatial manipulation and rendering | authoritative graph writes |
| Node | visual node behavior and local editing interaction | provider calls or approval decisions |
| Edge / port | typed connection presentation and gesture | duplicated type rules |
| Inspector | schema-driven edit presentation | SQLite schema knowledge |
| Validation panel | error grouping and recovery navigation | independent validation policy |
| Plan preview | deterministic preview presentation | execution |
| Status surfaces | human-readable state feedback | inventing new lifecycle states |

## 17. Accessibility and inclusive interaction

Accessibility is part of the visual system.

- Every canvas action must have a keyboard equivalent.
- Nodes and edges need accessible names and meaningful relationship descriptions.
- Focus must be visible and must not disappear behind panels.
- Text and controls must remain usable at larger sizes.
- Color is never the sole carrier of status or trust.
- Motion respects reduced-motion preferences.
- Tooltips supplement labels; they do not replace essential labels.
- Hit targets must be comfortable for mouse, touch, and assistive input.
- Errors are announced in text and associated with the relevant object.
- The app must remain usable without a minimap, animation, or color perception.

## 18. UX writing

Use plain, direct language.

Prefer:

```text
This connection needs Evidence, but the selected node provides a Proposal.
```

Over:

```text
Type mismatch: Proposal<T> cannot satisfy Evidence<Input>.
```

Technical detail may appear in an expandable explanation for advanced users.

Action labels should describe the result:

- `Preview plan`
- `Validate workflow`
- `Create revision`
- `Publish version`
- `Restore version`
- `Review evidence`

Avoid vague labels such as `Continue`, `Process`, or `Run` when the actual result can be named.

## 19. Platform-neutral implementation rules

Clarity currently targets a desktop/Electron direction. The design system should therefore use platform-neutral principles:

- CSS or UI tokens rather than Apple-only appearance APIs;
- a properly licensed system or open font stack;
- an open-licensed or Clarity-owned icon system;
- standard pointer, keyboard, and accessibility semantics;
- responsive layouts that work beyond a single Apple display size;
- no dependence on SF Symbols, Liquid Glass, or Apple-only controls.

Apple Design Resources and SF Symbols may be used as visual references during design exploration, but shipping assets require a separate license and attribution review.

## 20. Design review checklist

Before a Composer feature is accepted, verify:

### Purpose and clarity

- Does every visible control have a clear purpose?
- Can a user identify where they are, what they can do, and what happens next?
- Is the primary action visually obvious without becoming visually loud?

### Structure and behavior

- Is the workflow structure visible before advanced configuration?
- Are compatible actions discoverable?
- Are invalid actions prevented and explained?
- Can the user undo or recover from the action?

### Trust and safety

- Are source, retrieved evidence, proposal, staged result, and approved result distinguishable?
- Is provenance inspectable?
- Are approvals explicit?
- Does the UI avoid implying execution or approval during preview?

### Visual craft

- Are spacing, typography, alignment, and icon weights consistent?
- Are light, dark, empty, loading, invalid, stale, and failed states designed?
- Is motion purposeful and interruptible?
- Does the design remain calm when the graph becomes dense?

### Accessibility

- Is every meaningful action keyboard-accessible?
- Does the design work without color perception?
- Are focus, contrast, text scaling, and reduced motion supported?
- Are nodes, ports, edges, and validation messages understandable to assistive technology?

### Architecture and entropy

- Does the renderer avoid direct SQLite or provider access?
- Is each invariant owned by one module?
- Are design tokens centralized?
- Are duplicated validation rules absent?
- Are component tests present at meaningful seams?

## 21. Initial Chunk 5 application

Chunk 5 should use this system to build the first real Visual Workflow Composer slice:

1. establish semantic tokens and theme primitives;
2. implement the desktop shell with sidebar, canvas, and inspector;
3. render one versioned workflow definition through an application facade;
4. support node placement, selection, movement, and typed connections;
5. show immediate static validation;
6. provide deterministic plan preview;
7. persist through the Core command boundary;
8. test restart, invalid graphs, import/export, keyboard interaction, and accessibility states.

Chunk 5 must not add provider execution, arbitrary code execution, hosted accounts, or public distribution.

## 22. Open decisions

These decisions remain intentionally open and must be resolved before they become implementation dependencies:

- exact renderer/canvas library;
- final token values after visual prototype review;
- final icon source and license;
- whether the first canvas uses a visible grid by default;
- minimap behavior and large-graph performance threshold;
- exact responsive breakpoints;
- native mobile visual adaptation;
- final product brand palette and logo relationship;
- whether the workflow composer supports subgraphs in the first release.

Open decisions must not be silently converted into permanent architecture.

## 23. Source foundation

This document was derived from the following official Apple developer resources, with platform-specific implementation details intentionally excluded:

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [HIG Foundations](https://developer.apple.com/design/human-interface-guidelines/foundations)
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Principles of great design — WWDC26](https://developer.apple.com/videos/play/wwdc2026/250/)
- [Design foundations from idea to interface — WWDC25](https://developer.apple.com/videos/play/wwdc2025/359/?time=0)
- [SwiftUI documentation](https://developer.apple.com/documentation/swiftui)
- [SwiftUI Sample Code Library](https://developer.apple.com/documentation/samplecode/?q=swiftUI)
- [SF Symbols](https://developer.apple.com/sf-symbols/)

The handoff's Clarity architecture rules remain authoritative where they are more specific than this visual document.

