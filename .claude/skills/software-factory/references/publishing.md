# Publishing

## Example body

Describe each change that a user or caller notices across the whole branch against its target branch, each with its evidence. T3's review guide tours the code, so the body has no code links. Gaps, user actions and ticket status go in the final reply. Ignore the repository's template and checklist.

| Part      | Content                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening   | One or two sentences: the central change in the user's terms and what it makes possible                                                         |
| Entries   | One `###` heading per change, central change first, phrased as what now happens. Under it: at most two sentences, then its video or screenshots |
| Contracts | Collapsed, when public endpoints, schemas, flags, keys, migrations or exported APIs change: a before and after table, then the caller migration |

- **Evidence.** Put each video or screenshot under the entry it proves: one complete video per realistic journey, at most eight screenshots, and no durations or timestamps.
- **Before and after.** Show a changed screen as a two-column table with the same data, the target branch on the left. When speed or size is the change, add a before and after table with the command that measured it.
- **Also.** A change with nothing to show keeps its heading and sentences. Group minor changes under one `### Also` entry as one-line bullets. The last bullet names the generated files and the command that reproduces them.
- **Leave out** pass counts, test tables except a retrospective's probe counts, process notes, checklists, a proof section and anything that T3 or the pipeline shows.

```markdown
Integrations are now generated, not handwritten: the hosted catalog grows from 8 to 69 providers, and workflows start from their events.

### Provider events start workflow runs

A merge request starts a run and the run comments back; a forged token is rejected.

![A merge request starts a run](/uploads/<secret>/events-start-runs.mp4)

### The catalog keeps its rows while a filter loads

| Before                                                       | After                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| ![Blank table](/uploads/<secret>/catalog-loading-before.png) | ![Rows kept](/uploads/<secret>/catalog-loading-after.png) |

| Request            | Before | After | Command                              |
| ------------------ | ------ | ----- | ------------------------------------ |
| Catalog list, warm | 2.4 s  | 90 ms | `curl -w '%{time_total}' <list URL>` |

### Plugins come from API descriptions

`dual openapi-plugin` turns an OpenAPI, GraphQL, MCP or Postman source into a versioned plugin. A lock file freezes released actions, so regenerating changes only the unreleased version.

### Also

- Attio, Linear, GitHub and GitLab delete their webhooks on deactivation.
- `src/generated/**` and `bun.lock` are generated: `dual openapi-plugin` reproduces them.

<details><summary>Contracts and migration</summary>

| Contract            | Before | After                               |
| ------------------- | ------ | ----------------------------------- |
| Application version | 5.0.0  | 6.0.0 selects the generated plugins |

Released application versions keep their plugins; nothing changes for existing workflows.

</details>
```

## Commands

**Publishing.** Pass bodies as files, then check the published head, title, body and files against the branch. A body update keeps the draft state. Put each capture under its entry:

- **GitHub.** Write `![alt](./file.png)` in the body; `--attach` uploads the file and rewrites that reference. A video uses the same form.
- **GitLab.** `glab --attach` appends at the end, so upload each file through the API and paste the returned `markdown` under its entry. `glab` has no `--jq` option, so pipe into `jq`.

```bash
gh pr edit <number> --body-file <file> --attach './file.png#<alt text>'
token=$(glab config get token --host git.datapizza.tech) && curl -fsS -H "PRIVATE-TOKEN: $token" -F file=@<file> https://git.datapizza.tech/api/v4/projects/<project id>/uploads | jq -r .markdown
glab mr update <number> --description-file <file>
```

**Failed checks.** Read only the logs of failed jobs:

```bash
gh run view <run id> --log-failed
glab api "projects/<project>/pipelines/<pipeline id>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**Baseline.** To compare with the target branch, commit a checkpoint, run `git restore --source=origin/<target branch> -- <paths>`, run the check, then run `git restore --source=<checkpoint> -- <paths>`. Reinstall after a restore that changes a manifest or lockfile. Use an extra worktree only when both versions must run at once, and remove it afterwards.
