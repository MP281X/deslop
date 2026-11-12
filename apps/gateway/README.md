# Gateway

```bash
npm install --global @deslop/gateway
gateway service install --url https://gateway.mp281x.xyz --auth https://auth.mp281x.xyz --admins <github-id>
```

Register only `https://<gateway>/mcp` in each harness. Admins add and connect servers; everyone signed in shares them. AI keys and usage belong to each person, as described in this app's `AGENTS.md`.

## AI proxy

App servers start with `--gateway https://gateway.mp281x.xyz`.

Use `AiGateway` from `@deslop/runtime/server/ai`: `yield* gateway.apiUrl(provider)` and pass `yield* gateway.authorize(userId)` as the provider client's **construction-time** `transformClient`. OpenRouter's scoped `withClientTransform` does not cover streaming chat completions.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
