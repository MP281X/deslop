# Auth

Shared sign-in for Deslop apps that enable Auth: GitHub, or a code approved from a browser, phone or agent.

```bash
npm install --global @deslop/auth
auth service install --url https://auth.mp281x.xyz --auth https://auth.mp281x.xyz --admins <github-id> --github-client-id <id>
```

- **Secret**: `GITHUB_CLIENT_SECRET` in `~/.deslop/auth.env`.
- **MCP** at `/mcp`: `answer_request` approves a sign-in by its code.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
