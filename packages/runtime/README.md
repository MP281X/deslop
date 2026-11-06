# Deslop app runtime

Every Deslop app is one npm package with the same command line.

```bash
npm install --global @deslop/<app>
<app>                                   # run in the foreground on 127.0.0.1
<app> service install [flags]           # run as a user service that updates itself from npm
<app> service status | update | uninstall
```

`<app> --help` lists flags, environment names in brackets and defaults, including the app's own settings. Secrets go in `~/.deslop/<app>.env`, and data lives in `~/.deslop/<app>/`.
