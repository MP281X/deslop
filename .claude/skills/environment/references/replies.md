# Reply exhibits

Use these primitives when a visual earns its place; choose only the form that answers the question. Keep the conclusion in the first view and omit rows that do not affect a decision. Static HTML uses T3's theme variables, a fluid width, no outer card or horizontal padding, and content-driven height. Preview at phone width, then render. Motion only explains a mechanism and stops on its final state.

<!-- prettier-ignore -->
```css
body{padding-right:4px}
h3{font-size:13px;margin:20px 0 6px;padding-right:4px;display:flex;justify-content:space-between;gap:8px}h3:first-child{margin-top:0}
small,th,.m,.done{color:var(--muted-foreground);font-weight:400}small{font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px 6px 0;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}th{font-size:12px}th:last-child,td:last-child{padding-right:4px}
.n{font:12px var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}th.n{white-space:normal}
.stats{display:flex;flex-wrap:wrap;gap:8px 28px;margin:4px 0 14px}.stats b{display:flex;flex-direction:column;font-size:24px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}
.bar{display:block;position:relative;min-width:60px;height:6px;border-radius:3px;background:var(--muted);overflow:hidden}.bar i{position:absolute;inset:0 auto 0 var(--x,0);width:var(--w);border-radius:3px;background:var(--c,var(--chart-1))}.bar.err i{background:var(--destructive)}
.axis{display:flex;justify-content:space-between;color:var(--muted-foreground);font:11px var(--font-mono);margin-top:2px}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:var(--secondary);color:var(--secondary-foreground)}
.ok{color:var(--success)}.no{color:var(--destructive)}.warn{color:var(--warning)}.pick,.now{background:var(--accent-surface)}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 14px;font-size:13px;color:var(--muted-foreground)}.flow b{font-weight:500;color:var(--foreground);padding:2px 6px;border-radius:4px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:4px 0 14px;font-size:13px}dt{color:var(--muted-foreground)}dd{margin:0}
figure{margin:8px 0 14px}figure img{display:block;width:100%;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px)}figcaption{font-size:12px;color:var(--muted-foreground);margin-top:4px}
.cols{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 14px}.cols>*{flex:1 1 160px;min-width:0;margin:0}
```

`.bar` starts at zero by default; `<span class=bar><i style="--x:4%;--w:93%"></i></span>` instead spans 4–97%. Align `.axis` with the bars' plotting area, not their row labels; show actual values and units beside each bar. `.flow b` holds steps with `.now` current; `.pick` marks the chosen option, `.done` what recedes; `.stats b` holds a value with its `small` label.

| The user asks                              | Exhibit                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Which lines changed?                       | `diff` of the deciding lines under a `file:line` link                        |
| What does it do now?                       | The command or request and its real output                                   |
| What does a caller see?                    | The signature, or the request and response                                   |
| What does the screen look like?            | Captures, before and after side by side                                      |
| Which states exist?                        | mermaid `stateDiagram-v2`                                                    |
| How does it work? Who acts, in what order? | Page: the parts in flow order, arrows naming what moves, change marked       |
| Which option wins?                         | Page: one column per option over the same rows, deciding row and pick marked |
| How much, how fast?                        | Page: each number large over its label; bars from zero on one axis           |
| Where did the time go?                     | Page: bars on one time axis                                                  |
| What runs in parallel? What is the plan?   | Page: one lane per worker or step, one line each                             |
| Where exactly is the defect?               | Capture with numbered markers and short notes                                |
| What will a video show?                    | Page: storyboard of chapter frames, the outcome marked                       |
| What does the parameter do?                | Page: the real example with one slider that changes it                       |

````markdown
**DOS-289, GitHub webhooks**: a request with a wrong signature now gets `401` and starts no run.

### The webhook route verifies the signature before it starts a run

[packages/server/src/webhooks/github.ts:31](packages/server/src/webhooks/github.ts#L31)

```diff
- yield* runs.start(workflowId, payload)
+ yield* verifySignature(request, secret)
+ yield* runs.start(workflowId, payload)
```

```bash
curl -si -X POST -H 'X-Hub-Signature-256: sha256=00' --data '{}' "$PREVIEW/api/webhooks/github/wf_1"
# → HTTP/2 401 {"reason":"signature"}
```
````
