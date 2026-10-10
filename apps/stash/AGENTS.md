# Stash

A personal link inbox for one iPhone. This folder holds the Effect server that runs on `dev`.

## Server

- **Run.** `vp -C apps/stash run preview` builds `dist/server.js` and serves it on `127.0.0.1:5017`; `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017` publishes it as `https://dev.tailnet-8c4c.ts.net:8443`. The tailnet is the only sign-in, so never bind it to `0.0.0.0` on `dev`, which has a public address.
- **Environment.** `OPENROUTER_API_KEY` in `~/.deslop/stash.env` turns tagging on. `STASH_DATA_DIR` defaults to `~/.deslop/stash`, `STASH_AI_MODEL` to `openai/gpt-6-luna` and `STASH_AI_BUDGET_USD` to 1 per month.
- **Routes.** Clients use the JSON WebSocket RPC at `/api/rpc` and download previews from `/api/images/<id>`; `POST /api/capture` takes `{id, text}` from clients that cannot speak the RPC protocol.
- **Previews.** The server keeps each link's preview image on disk, because TikTok's image links expire within days.

## Decisions

| Rejected                 | Reason                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Binary RPC serialization | The earlier web version failed to reopen a cancelled watch with it |
