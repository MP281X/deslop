# template-app

```bash
npm install -g @deslop/template-app
template-app service install
```

The server uses the runtime's binary RPC and SQLite data layer. Add numbered migrations with Effect's SQLite migrator when a service first needs persisted data; there is no stored data in this starter.

Before publishing iOS, follow `.github/releasing.md`, **Publish an iOS app**. Set the EAS project id in `app.config.ts`.
