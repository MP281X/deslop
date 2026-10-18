# @deslop/stash

Saves a link or text to the owner's stash server and prints the read, tagged note as Markdown.

```bash
vpx @deslop/stash@latest login '<api key>'
vpx @deslop/stash@latest save '<link or text>' [--server <url>]
```

`login` keeps an API key created at https://auth.mp281x.xyz in `~/.deslop/stash/api-key`.
