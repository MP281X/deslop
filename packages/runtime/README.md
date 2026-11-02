# Deslop app runtime

Every Deslop app is one npm package with the same command line.

```bash
npm install --global @deslop/<app>
<app>                                   # run in the foreground on 127.0.0.1
<app> service install [flags]           # run as a user service that updates itself from npm
<app> service status | update | uninstall
```

| Flag       | Env        | Use                                                    |
| ---------- | ---------- | ------------------------------------------------------ |
| `--url`    | `APP_URL`  | The address people reach it at, such as its HTTPS name |
| `--auth`   | `AUTH_URL` | Deslop Auth; without it there is no sign-in            |
| `--traces` | `OTEL_URL` | Scope, to send traces and logs to                      |
| `--port`   | `PORT`     | Listen port; each app has its own default              |
| `--host`   | `HOST`     | Listen address; `127.0.0.1` by default                 |

`<app> --help` lists the app's own flags. Secrets go in `~/.deslop/<app>.env`, and data lives in `~/.deslop/<app>/`.
