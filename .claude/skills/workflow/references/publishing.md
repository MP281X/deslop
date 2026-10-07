# Publishing

## Example body

Copy this shape. The branch arrives ready to review and merge, so the body has no Gaps. Settle missing access and open decisions in the thread before pushing. Describe what the final branch changes and how to review it, not its history, and keep consequential risks. The open part above the first collapsed section must fit on one screen. Each budget is a maximum, not a target.

| Section      | Budget                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result       | Two lines, written as what a user or caller can now do                                                                                                                                                                                              |
| Needs you    | Decisions and actions only, never facts or a backlog                                                                                                                                                                                                |
| Ticket       | Every requirement of the source tickets, each done, partial or missing                                                                                                                                                                              |
| Changed      | At most eight behavior bullets; a before → after table, linked to lines, only for public or breaking endpoints, schemas, flags, keys, migrations and exported APIs                                                                                  |
| Proof        | One complete video per realistic journey, and at most eight cropped screenshots                                                                                                                                                                     |
| Review guide | One row per area in reading order: area, at most three files, and 25 words on behavior, mechanism and what to check; a last row of mechanical files to skip with the hand-written size per package and the command that reproduces generated output |
| Checklist    | The repository template's checklist, ticked only for what the branch did                                                                                                                                                                            |

Leave out pass numbers, test tables, process words and anything T3 or the pipeline already shows.

- **Ticket rows** quote the requirement's title from the ticket, in its language. Link a ticket only when the reviewer can open it.
- **Captions** state the claim and the duration above each video. Screenshots sit in a two-column table, each with a caption.
- **Before and after.** Show a changed screen as a pair with the same data, the default branch on the left.
- **Numbers.** When speed or size is part of the claim, give a small before and after table with the command that measured it.
- **Repository template.** When the repository has a merge request template, keep its checklist as the last section and tick it truthfully.

```markdown
Workflows can call 69 providers (was 8) and start from their webhooks or polling. Attio, Linear, GitHub and GitLab register their webhooks automatically.

**Needs you:**

- Decide whether GraphQL field order joins the action hash; today a reordered schema creates a new action version.

**Ticket:**

| Requirement                            | State                                      | Where                               |
| -------------------------------------- | ------------------------------------------ | ----------------------------------- |
| Power BI Remote MCP plugin             | Done; a live query needs a Power BI tenant | [powerbi-mcp](link)                 |
| Attio and Linear register webhooks     | Done                                       | [attio triggers.ts](link#L138-L170) |
| Jira automation rule starts a workflow | Done                                       | [jira triggers.ts](link#L90-L140)   |
| Manage tools connected to Jira         | Missing: the ticket asks for an evaluation | —                                   |

**Changed:**

- The catalog lists 22,600 capabilities and keeps the previous rows while a filter loads.
- A Jira automation rule can start a workflow with a shared token header.

**Proof:**

Events start runs (1:20): a signed Jira delivery starts a run, a forged one is rejected, an automation rule starts a run.

![Events start runs](/uploads/<secret>/events-start-runs.mp4)

| Catalog while a filter loads, before                         | After                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| ![Blank table](/uploads/<secret>/catalog-loading-before.png) | ![Rows kept](/uploads/<secret>/catalog-loading-after.png) |

| Request            | Before | After | Command                              |
| ------------------ | ------ | ----- | ------------------------------------ |
| Catalog list, warm | 2.4 s  | 90 ms | `curl -w '%{time_total}' <list URL>` |

<details><summary>Review guide</summary>

| Order | Area          | Files                                | What to check                                                           |
| ----- | ------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| 1     | Catalog cache | [RegistryCatalogRepository.ts](link) | Release rows load once per release; usage and failures load per request |
| Skip  | Mechanical    | `src/generated/**`, `bun.lock`       | Generated by `dual openapi-plugin`; hand-written size: server +420 −80  |

</details>

**Checklist:**

- [x] Agent surface: new `ProductApi` endpoints are classified
- [x] Docs: affected guides updated
- [x] Changeset added
```

## Commands

**Links.** GitHub uses `https://github.com/<owner>/<repo>/blob/<branch>/<path>#L<start>-L<end>`. GitLab uses `https://<host>/<project>/-/blob/<branch>/<path>#L<start>-<end>`.

**Publishing.** Pass bodies and comments as files. Attach an image as `--attach '<file>#<alt text>'` and a GitHub video as a bare `--attach '<file>'`. `glab` has no `--jq` option, so pipe its API output into `jq`. Check the published head, title, body and files against the branch.

```bash
gh pr edit --body-file <file> --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <file> --attach <file>
```

**Wakes.** T3's watch wakes the thread for failed or completed checks, comments, reviews and conflicts. Handle the cause of each wake, resolve actionable review findings, and read logs only of failed jobs.

**No T3 watch.** Run one blocking command in the background under `timeout 2h`. If no run exists for the head, inspect the pipeline trigger instead of polling.

```bash
ID=$(gh run list --commit "$(git rev-parse HEAD)" --json databaseId -q '.[0].databaseId'); : "${ID:?No run for this commit}"
gh run watch "$ID" --exit-status --compact; STATUS=$?; [ $STATUS -eq 0 ] || gh run view "$ID" --log-failed; exit $STATUS
glab ci status --wait --compact
glab api "projects/<project>/pipelines/<pipeline id>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**Baseline.** To compare with the default branch, commit a checkpoint and run `git restore --source=origin/<default branch> -- <paths>`. Run the check, then reset to the checkpoint. Reinstall after the restore and again after the reset when a manifest or lockfile changed. Create an extra worktree only when both versions must run at once, and remove it afterwards.
