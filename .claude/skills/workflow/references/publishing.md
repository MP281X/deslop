# Publishing

## Example body

The body reads as a changelog with evidence. It describes the whole branch against its target branch, one entry per change a user or caller notices, each with the evidence that proves it. It is not a record of the last run or of the branch's history. The branch arrives ready to review, so the body has no Gaps, no Needs you and no ticket table; those go in the final reply. Ignore the repository's template and its checklist.

| Part      | Content                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening   | One or two sentences: the central change in the user's terms and what it makes possible. When you cannot name the central change, ask the user in a question card before writing                          |
| Entries   | One `###` heading per change, central change first, phrased as what now happens. Under it: at most two sentences, then its video or screenshots, then a `Code:` line that links the lines implementing it |
| Contracts | Collapsed, when public or breaking endpoints, schemas, flags, keys, migrations or exported APIs change: a before and after table linked to lines, then the migration a caller needs                       |
| Review    | Collapsed. The reading order as a numbered list: the entry, at most three files and what to check. A last item names the generated or mechanical files to skip, with the command that reproduces them     |

- **Evidence.** Put each video or screenshot under the entry it proves; there is no separate proof section. A video gets no duration or timestamp. One complete video per realistic journey, and at most eight screenshots in the body.
- **Before and after.** Show a changed screen as a two-column table with the same data, the target branch on the left.
- **Numbers.** When speed or size is the change, the entry holds a small before and after table with the command that measured it.
- **Small entries.** A change with nothing to show keeps its heading, its sentences and its `Code:` line. Group several minor changes under one `### Also` entry as one-line bullets.
- **Leave out** pass counts, test tables, process words, checklists and anything T3 or the pipeline already shows.

```markdown
Integrations are now generated, not handwritten: the hosted catalog grows from 8 to 69 providers, and workflows start from their events.

### Provider events start workflow runs

A merge request starts a run and the run comments back; a forged token is rejected.

![A merge request starts a run](/uploads/<secret>/events-start-runs.mp4)

Code: [webhook registration](link#L138-L170) · [token check](link#L40-L72)

### The catalog keeps its rows while a filter loads

| Before                                                       | After                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| ![Blank table](/uploads/<secret>/catalog-loading-before.png) | ![Rows kept](/uploads/<secret>/catalog-loading-after.png) |

| Request            | Before | After | Command                              |
| ------------------ | ------ | ----- | ------------------------------------ |
| Catalog list, warm | 2.4 s  | 90 ms | `curl -w '%{time_total}' <list URL>` |

Code: [RegistryCatalogRepository.ts](link#L20-L64)

### Plugins come from API descriptions

`dual openapi-plugin` turns an OpenAPI, GraphQL, MCP or Postman source into a versioned plugin. A lock file freezes released actions, so regenerating changes only the unreleased version.

Code: [generator](link#L1-L90) · [lock file](link#L10-L40)

### Also

- Attio, Linear, GitHub and GitLab delete their webhooks on deactivation ([code](link#L171-L190)).

<details><summary>Contracts and migration</summary>

| Contract                    | Before | After                               |
| --------------------------- | ------ | ----------------------------------- |
| [Application version](link) | 5.0.0  | 6.0.0 selects the generated plugins |

Released application versions keep their plugins; nothing changes for existing workflows.

</details>

<details><summary>How to review</summary>

1. Provider events: [triggers.ts](link), [webhooks.ts](link). Check the token comparison and retry identity.
2. Catalog: [RegistryCatalogRepository.ts](link). Release rows load once per release; usage loads per request.
3. Skip `src/generated/**` and `bun.lock`: `dual openapi-plugin` regenerates them. Hand-written size: server +420 −80.

</details>
```

## Commands

**Links.** GitHub uses `https://github.com/<owner>/<repo>/blob/<branch>/<path>#L<start>-L<end>`. GitLab uses `https://<host>/<project>/-/blob/<branch>/<path>#L<start>-<end>`.

**Publishing.** Pass bodies as files, and check the published head, title, body and files against the branch. Place each capture under its entry:

- **GitHub.** Reference the file in the body as `![alt](./file.png)`; `--attach` uploads it and rewrites that reference in place. A video is a bare `--attach` with the same reference.
- **GitLab.** `glab --attach` appends at the end, so upload each file through the API and paste the returned `markdown` under its entry. `glab` has no `--jq` option, so pipe its output into `jq`.

```bash
gh pr edit <number> --body-file <file> --attach './file.png#<alt text>'
curl -fsS -H "PRIVATE-TOKEN: $(glab config get token --host git.datapizza.tech)" -F file=@<file> https://git.datapizza.tech/api/v4/projects/<project id>/uploads | jq -r .markdown
glab mr update <number> --draft --description-file <file>
```

**Failed checks.** Read the logs of failed jobs only.

```bash
gh run view <run id> --log-failed
glab api "projects/<project>/pipelines/<pipeline id>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**Baseline.** To compare with the default branch, commit a checkpoint and run `git restore --source=origin/<default branch> -- <paths>`. Run the check, then reset to the checkpoint. Reinstall after the restore and again after the reset when a manifest or lockfile changed. Create an extra worktree only when both versions must run at once, and remove it afterwards.
