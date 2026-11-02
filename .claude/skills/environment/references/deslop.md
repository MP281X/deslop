# Deslop

The repository's `AGENTS.md` and `RELEASING.md` own its commands and releases; this is the user's hosts and accounts around them.

## Hosts

- **Production**: on dev each app is a user service, `deslop-<app>.service`, running `~/.deslop/<app>/current` and following npm's latest release; Deploy's Caddy, `deslop-deploy-caddy.service`, serves its owned `*.mp281x.xyz` hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them). desktop runs only Deploy, at `https://desktop.tailnet-8c4c.ts.net:5102`, reached by dev's with the `DEPLOY_KEY` both `~/.deslop/deploy.env` hold. Flags live in each unit, secrets in `~/.deslop/<app>.env`.
- **Preview**: the portfolio's production build, so rerun `preview` after edits; another web app runs the same command with its `--filter`. `NODE_ENV=development` signs everyone in as `dev` with no OAuth, and Auth's **Sign in with GitHub** returns as `dev` at once.
- **Stash**: no worktree preview; `deslop-stash.service` serves `https://stash.mp281x.xyz`, and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin and shared Keychain credentials. Scratch run on another port from a checkout, with its own data in the checkout's `.deslop/stash`: `vp -C apps/stash run build && node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018`.
- **`~/.deslop/stash.env`**: the variables of `apps/stash/.env.example`; `STASH_PROXY` is the DataImpulse residential plan "stash", `__sessid.{session}` after the login.

## Accounts

- **npm**: `matteo_paludgnach` approves a first publish's URL.
- **Apple**: App Store Connect API key `XPDBFL4L6T`; the cached session in `~/.app-store/auth` answers `eas-cli` prompts; on expiry the user signs in again with the same command.
- **EAS**: paid cloud builds need the user's approval.

## Tracing

- **Public**: `https://scope.mp281x.xyz/v1/traces` and `/v1/logs`, open to any origin without credentials; apps pass `--traces https://scope.mp281x.xyz`.
- **Tailnet**: `https://dev.tailnet-8c4c.ts.net:4318`, Tailscale Serve to Scope's port, `sudo tailscale serve --bg --https=4318 http://127.0.0.1:5106`.
