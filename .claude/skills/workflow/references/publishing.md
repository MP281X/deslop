# Publishing

## Example body

Copy this shape. The body describes the whole branch against the default branch: its central change first, then everything else it changes, and how to review it. It is not a record of the last run or of the branch's history. The branch arrives ready to review and merge, so the body has no Gaps, no Needs you and no ticket table. Ticket coverage, open decisions and follow-ups go to the user in the thread before the push. Each budget is a maximum, not a target.

| Section      | Budget                                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus        | Two short paragraphs: the one central change in the user's terms, then what it makes possible. When you cannot name the central change, ask the user in the thread before writing                                                                              |
| Changed      | Every behavior change, grouped under italic area headings with the central area first. One line per bullet, linked to the lines that implement it. A small table when a list of comparable facts is the claim, such as installed libraries and their versions  |
| Contracts    | Collapsed, when public or breaking endpoints, schemas, flags, keys, migrations or exported APIs change: a before and after table linked to lines, then the migration a caller needs                                                                            |
| Proof        | One complete video per realistic journey, and at most eight cropped screenshots                                                                                                                                                                                |
| Review guide | Collapsed. One row per area in reading order: area, at most three files, and 25 words on behavior, mechanism and what to check; a last row of mechanical files to skip with the hand-written size per package and the command that reproduces generated output |
| Checklist    | The repository template's checklist, ticked only for what the branch did                                                                                                                                                                                       |

Leave out pass numbers, test tables, process words and anything T3 or the pipeline already shows.

- **Captions** state the claim and the duration above each video. Screenshots sit in a two-column table, each with a caption.
- **Before and after.** Show a changed screen as a pair with the same data, the default branch on the left.
- **Numbers.** When speed or size is part of the claim, give a small before and after table with the command that measured it.
- **Repository template.** When the repository has a merge request template, keep its checklist as the last section and tick it truthfully.

```markdown
Integrations are now generated, not handwritten. `dual openapi-plugin` turns an OpenAPI, Swagger, Google Discovery, GraphQL, MCP or Postman source into a versioned plugin, and the hosted catalog grows from 8 to 69 providers.

On top of the generated catalog, workflows start from provider webhooks or polling, and the Architect finds actions and triggers by describing the outcome.

**Changed:**

_Generated plugins_

- Each plugin keeps a [lock file](link#L10-L40) that freezes released action contracts; regenerating changes only the unreleased version.

_Triggers_

- Attio, Linear, GitHub and GitLab [register their webhooks](link#L138-L170) on activation and delete them on deactivation.

_Registry catalog_

- The catalog lists 22,600 capabilities and keeps the previous rows while a filter loads.

<details><summary>Contracts and migration</summary>

| Contract                    | Before | After                               |
| --------------------------- | ------ | ----------------------------------- |
| [Application version](link) | 5.0.0  | 6.0.0 selects the generated plugins |

Migration: released application versions keep their plugins; nothing changes for existing workflows.

</details>

**Proof:**

Events start runs (1:20): a merge request starts a run, a forged token is rejected, the run comments and posts to Discord.

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
