---
name: output
description: Load before every final reply, PR body, plan card, mock or rendered page. Picks the one form that carries the meaning, enforces the one-screen and word budget, and audits the result before it is sent.
---

# Output

The user reads the result, not the process. Every reply, PR body and page answers one question or asks one decision.

## One idea

- The first line is the outcome or the decision, in plain words, named as the user sees it: the app, the screen, the behavior.
- One reply, one idea. If a second idea does not change the next action, it belongs in the PR body or a link, not the reply.
- Evidence follows; nothing restates the visual.

## Pick the form

| The fact is                              | The form                                          |
| ---------------------------------------- | ------------------------------------------------- |
| A number, a comparison or a set of facts | One table, at most six rows                       |
| A sequence, a flow or a dependency       | Mermaid in the reply; one HTML flow on a page     |
| Two or three states, options or screens  | Side by side, drawn, each with its cost           |
| A screen or a behavior                   | A mock of the screen, never prose about it        |
| An architecture                          | One diagram; before and after only if both matter |
| A code change                            | A diff or the code it adds                        |
| A single fact                            | One line                                          |

Use GFM when plain structure carries it. Use `html_render` only when color, position or the thing itself carries meaning; never a page that is styled prose. Start from [references/page.html](references/page.html) when a page is the form.

## Budget

- One phone screen at 390px; a plan card may take two.
- At most 120 visible words on a page, 80 in a chat reply, 25 in a paragraph.
- One h1, at most three sections, six table rows, three cards. Labels are words, not sentences.
- Cut anything that repeats the visual, describes the process, or is already in the PR body.
- Cut one accessory from every page: the extra card, the fourth column, the explanatory footnote.

## Design

- Use the app's tokens and font. Deslop: JetBrains Mono, square, hairlines, zinc neutrals, Kanagawa identity hues. Dual: its own tokens.
- One accent for the one thing to look at. One radius. No boxes inside boxes, gradients, shadows, glow or decorative icons.
- Color carries meaning: state hues for status, chart hues for identity. No color for decoration.
- Nothing animates. No hero image unless the image is the evidence.
- Real content and one worked example; no lorem ipsum.

## Before sending

1. Render the page. Open it at 390px and 1440px.
2. In an app preview, pass [references/budget.js](references/budget.js) and [../verification/references/page-audit.js](../verification/references/page-audit.js) to `preview_evaluate`; fix every entry, or give a reason. For an `html_render` page, `html_preview` at 390px is the check: read the screenshot and count against the budget.
3. Read it as the user: what changed, what do I do, what is the one thing? If that takes more than five seconds, cut.
4. Check the first line is the outcome; every fact appears once; no progress or process.
5. For a PR, the template is the structure and this skill is the budget: one line summary, one visual, one line per claim with its capture.

If the page cannot be rendered, use GFM and say `unverified: page not rendered`; never hand-write HTML without rendering it.

## Examples

[references/examples.md](references/examples.md) holds the good and bad shapes for the Dual governance page and for a chat reply.
