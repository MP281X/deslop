# Host maintenance

Run when the user asks to update or clean the host, and after a merge that changes `tools/compose.yaml` or the portfolio.

1. Update: `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, and `vp update -g`. Claude Code and t3 update themselves.
2. Deploy from `/home/mp281x/deslop` on an up-to-date `main` once its CI run has published the portfolio image: `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`; compose ignores changes to inline `configs`, so after one changes, also `up -d --force-recreate --no-deps` the service that mounts it.
3. Verify that https://portfolio.mp281x.xyz and the local Jaeger API http://127.0.0.1:16686/api/services return 200, and that an OPTIONS preflight to `/v1/traces` and `/v1/logs` on otel with `Origin: https://portfolio.mp281x.xyz` succeeds.
4. ufw allows 4000:4009/tcp from the `deslop` network's current subnet (`docker network inspect deslop`) with the comment `deslop previews`.
5. Remove what removed worktrees left: compose projects other than `deslop` whose `com.docker.compose.project.working_dir` no longer exists (`docker compose --project-name <project> down --volumes --remove-orphans`), listeners on 4000–4009 whose `/proc/<pid>/cwd` ends in `(deleted)` (stop their process group), and every folder in `~/.deslop` other than `deploy`, `measure`, and `repos` whose name matches no checkout in `git worktree list` of `/home/mp281x/deslop` or `/home/mp281x/dual` and that no running process uses as its working directory (`/proc/*/cwd`).
6. Prune: `docker image prune -a -f`, `docker builder prune -a -f --filter until=168h`, and `docker volume prune -f`.
