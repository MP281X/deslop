# Gateway

One MCP endpoint for every MCP server you connect; add servers on its page.

```bash
npm install --global @deslop/gateway
gateway service install --url https://gateway.mp281x.xyz --auth https://auth.mp281x.xyz --admins <github-id>
```

- **Register** only `https://<gateway>/mcp` in each harness; tools are named `<server>__<tool>`.
- **Admins** (`--admins`) add and connect servers; everyone signed in shares them.
- **Own tool**: `list_mcp_connections` explains a missing or failing server.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
