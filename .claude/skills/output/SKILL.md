---
name: output
description: Load before every final reply, PR body, plan card, mock or rendered page. Forces one real visualization with meaningful color, not cards or prose, and checks it before sending.
---

# Output

The user reads the result, not the process. Every visual output carries one idea.

## One idea

- The first line is the outcome or the decision, in plain words, named as the user sees it.
- One output, one idea. A second idea belongs in the PR body or a link.
- The visual carries the relationship or the number; text only labels it.

## A visualization, not decoration

Call it a visualization only if it is one of: a node-link graph, Sankey, timeline, Gantt, flame graph, heatmap, matrix, treemap, bar/line/scatter chart, map, annotated screenshot, state machine, or a flow with a spatial layout.

Cards, bullet lists, tables, tabs, progress bars, a row of colored dots and a headline with colored words are not visualizations. They may support the one visual; they never replace it.

- Color encodes a category, value or state, with a legend. At least three meaningful hues when the data has three categories; one accent for the selected path. No decorative color.
- Interaction belongs to the visual: hover or focus highlights connected nodes or series and shows a tooltip; click pins. No tabs, no hidden panes, no separate detail card.
- One visual, one idea, one screen at 390px. If it needs a second visual, it is two outputs.

## Pick the visual

| The fact is                  | The visual                 |
| ---------------------------- | -------------------------- |
| A rule, path or dependency   | Node-link graph            |
| Volume moving between stages | Sankey                     |
| Time, spans or steps         | Timeline, Gantt or flame   |
| People × resources           | Heatmap or matrix          |
| A number over time or groups | Bar, line or scatter       |
| A screen or behavior         | Annotated screenshot, mock |
| Named states and events      | State machine              |

## Pattern

A node-link graph is the default for a rule or path. Keep the SVG in a 360×360 viewBox, one hue per node kind, one accent for the selected path, and a tooltip that names the rule.

```html
<svg viewBox="0 0 360 360">
	<g class="edge" data-edge="group-space" data-from="group" data-to="space">
		<path d="M90 70V136" />
		<text x="96" y="106">View + Use</text>
	</g>
	<g class="node" data-node="group" tabindex="0">
		<rect x="20" y="16" width="140" height="54" />
		<text x="34" y="47">Group "Sales team"</text>
	</g>
</svg>
<script>
	// pointerenter/focus a node: add .active to it and its edges, dim the rest, fill the tooltip.
</script>
```

## Budget

- One phone screen at 390px; a plan card may take two.
- At most 80 visible words outside the visual's labels; 25 in a paragraph.
- One h1, one visual, at most three supporting rows.
- Cut anything that repeats the visual, describes the process, or is already in the PR.

## Design

- The app's tokens and font. Deslop: JetBrains Mono, square, hairlines, zinc neutrals, Kanagawa identity hues. Dual: its own tokens.
- One accent for the selected path; one radius; no boxes inside boxes, gradients, shadows or glow.
- Real content and one worked example.
- Nothing animates; interaction changes instantly.

## Before sending

1. Render the page; open it at 390px and 1440px.
2. Hover and focus every node or series; the tooltip and highlight must work.
3. Check color: every hue maps to a category or value in the legend; no decorative color.
4. Read it as the user: what changed, what do I do, what is the one thing? Cut until that takes five seconds.
5. If it is cards, a table or prose with color, it is not a visualization; rebuild it.

If the page cannot be rendered, use GFM and say `unverified: page not rendered`.
