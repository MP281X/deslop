# template-app

```bash
npm install -g @deslop/template-app
template-app service install
```

Local preview: `vp run --filter @deslop/template-app preview`.

The server uses the runtime's binary RPC and SQLite data layer. Add numbered migrations with Effect's SQLite migrator when a service first needs persisted data; there is no stored data in this starter.
