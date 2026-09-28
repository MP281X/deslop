# Host maintenance

Run when the user asks to update or clean the host, and after a merge that changes `tools/production.compose.yaml` or the portfolio.

1. Update: `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, and `vp update -g`. Claude Code and t3 update themselves.
2. Deploy from `/home/mp281x/deslop` on an up-to-date `main`: `vp install`, `VITE_OTEL_URL=https://otel.mp281x.xyz vp run build`, `docker build --tag ghcr.io/mp281x/deslop-portfolio:latest apps/portfolio`, then `docker compose --project-name deslop --file tools/production.compose.yaml` with `pull traefik jaeger collector` and `up -d --remove-orphans --pull never`.
3. Verify that https://portfolio.mp281x.xyz, https://te-amo-muchisimo.mp281x.xyz, and https://otel.mp281x.xyz/api/services return 200, and that an OPTIONS preflight to `/v1/traces` and `/v1/logs` on otel with `Origin: https://portfolio.mp281x.xyz` succeeds.
4. ufw allows 4000:4009/tcp from the `deslop` network's current subnet (`docker network inspect deslop`) with the comment `deslop previews`.
5. Remove what removed worktrees left: compose projects other than `deslop` whose `com.docker.compose.project.working_dir` no longer exists (`docker compose --project-name <project> down --volumes --remove-orphans`), listeners on 4000–4009 whose `/proc/<pid>/cwd` ends in `(deleted)` (stop their process group), and `~/.deslop/t3code-*` folders with no worktree under `~/.t3/worktrees/*/`.
6. Prune: `docker image prune -a -f`, `docker builder prune -a -f --filter until=168h`, and `docker volume prune -f`.
