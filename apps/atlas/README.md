# Atlas

A map of pull requests across GitHub and GitLab: where each change lands in the tree, what is in flight, and what moves together.

```bash
npm install --global @deslop/atlas
atlas service install --url https://atlas.mp281x.xyz --auth https://auth.mp281x.xyz
```

- **Repositories** come from `ATLAS_REPOS`, comma-separated as `host/owner/name`; `github.com` uses the signed-in `gh`, every other host the signed-in `glab`. The defaults are `github.com/MP281X/deslop` and `git.datapizza.tech/dual/dual`.
- **Views**: `map` draws each pull request as a treemap of its areas; `flow` draws every pull request as a strip from opened to last activity; `couple` draws a matrix of areas that change together.
- **Merged** pull requests stay for 30 days so the coupling matrix sees recent history.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
