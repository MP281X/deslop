# @deslop/components-web

The shared web surface: Sera shadcn primitives, the full-height shell, the command palette and the small compositions every app repeats. The repository `AGENTS.md`'s Design owns the visual rules; this file is the component contract.

## Rules

- `src/ui/` holds the shipped Sera components. Refresh them with `vpx shadcn@latest add --all --overwrite` from this package; do not hand-edit their look. A call site may place a primitive, pick a variant or compose it, never repaint it.
- Tokens live in `src/theme.css`; a component reads `--background`, `--foreground`, `--card`, `--muted-foreground`, `--border`, `--primary` and the chart/sidebar names. Never a raw colour in a component.
- `cn` is the local class merger in `src/lib/utils.ts`, exported as `@deslop/components-web/utils`; primitives and call sites import that one helper. When the CLI vendors a primitive, point its `cn` import at `#lib/utils.ts` and drop the `cn` dependency.
- Icons are Phosphor: regular at 16px and below, light at 20px and above. One icon set per surface.
- A page action lives in the `CommandDialog` palette; a page control that chooses what the page shows stays in the masthead.

## Composition

| Need                               | Use                                                       | Instead of                                |
| ---------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| A page                             | `Page` + `PageHeader` + `Section`                         | a bespoke centred column per app          |
| A row list                         | `Table` for columns, `Item`/`ItemGroup` for one-line rows | hand-built flex rows with ad-hoc dividers |
| A section label and count          | `Section` `title` + `meta`                                | a heading and a separate badge            |
| A single fact                      | `Stat`                                                    | a card with a number and a caption        |
| Empty first run                    | `EmptyState` with a description and an action             | a lone icon or "No items"                 |
| Nothing selected                   | `EmptyState` with only an icon                            | explanatory copy in a detail pane         |
| A blocking failure                 | `Error` with a destructive Retry                          | a hero, alert stack or raw error          |
| A transient failure beside content | `Problem`                                                 | a toast or a banner that moves the page   |
| A form field                       | `Field`, `FieldLabel`, `FieldError`, `Input`/`InputGroup` | a label, input and error stacked by hand  |
| A confirmation                     | `AlertDialog`                                             | `confirm()`                               |
| A searchable action list           | `Command`/`CommandDialog`                                 | a filter bar or chips                     |
| A split workspace                  | `ResizablePanelGroup` + `ScrollArea`                      | fixed grid columns that cannot be resized |
| A chart                            | `Chart` with `--chart-*` tokens                           | an SVG with hand-picked colours           |

## Inventory

The 63 installed primitives, grouped by the job they do. A component missing from this list is not installed; add it with the CLI.

**Actions and navigation** — `Button`, `Button Group`, `Toggle`, `Toggle Group`, `Breadcrumb`, `Navigation Menu`, `Menubar`, `Pagination`, `Sidebar`, `Tabs`, `Command`, `Dropdown Menu`, `Context Menu`, `Combobox`, `Select`, `Native Select`.

**Content and layout** — `Card`, `Item`, `Empty`, `Table`, `Accordion`, `Collapsible`, `Separator`, `Aspect Ratio`, `Carousel`, `Resizable`, `Scroll Area`, `Sheet`, `Drawer`, `Dialog`, `Alert Dialog`, `Popover`, `Hover Card`, `Tooltip`.

**Forms** — `Field`, `Label`, `Input`, `Input Group`, `Input OTP`, `Textarea`, `Checkbox`, `Radio Group`, `Switch`, `Slider`, `Calendar`, `Combobox`.

**Feedback and status** — `Alert`, `Badge`, `Marker`, `Progress`, `Skeleton`, `Spinner`, `Toast`, `Kbd`, `Avatar`, `Trace`.

**Data and documents** — `Chart`, `Code Block`, `Message`, `Message Scroller`, `Attachment`, `Bubble`, `Questionnaire`.

**Direction** — `Direction` (RTL plumbing; the apps are English-only today).

`Trace` is the tree-rendering primitive for spans and tool calls; Scope's waterfall keeps its own time-scale geometry and composes `Trace` only where a tree is the data shape.
