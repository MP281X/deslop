# Atlas intent

- **Scope.** Every open pull request and every pull request merged in the last 30 days, for each repository in `ATLAS_REPOS`, from GitHub through `gh` and from GitLab through `glab`; no pasted tokens.
- **Views.** Three answers, one chosen in the bar: `map` is a small treemap per pull request, sized by churn and grouped by top-level area; `flow` is one strip per pull request from opened to merged or now, in flight first; `couple` is the matrix of areas that share pull requests.
- **Selection.** The URL stores the repository, view and pull request number. Selecting anywhere opens that pull request's files, never a record copy.
- **Monorepo.** An area is `apps/x`, `packages/x`, `tools/x` or another two-segment workspace root when the path has one; otherwise the first directory. A single-package repository therefore maps as itself.
- **Problems.** A repository that fails keeps its previous rows and carries a problem dot on its tab; one failure never hides another repository's map. No banners, toasts or retries in the page body.
- **Phone.** The map, flow and matrix fill the screen; selecting a pull request pushes its files, and the bar's caret returns.
