# Deslop app runtime

Every Deslop app uses the same command line.

```bash
npm install --global @deslop/<app>
<app>                                   # run in the foreground on 127.0.0.1
<app> service install [flags]           # run as a user service that updates itself from npm
<app> service status | update | uninstall
```

Run `<app> --help` to list settings. Root `AGENTS.md` holds the repository's data and secrets policy.
