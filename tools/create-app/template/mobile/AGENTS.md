# template-app

An authenticated iOS app with a binary RPC server. Keep its product intent and real user journeys here as features are added.

Services live in `src/services/<name>/`: `schema.ts` defines shared contracts, `service.ts` owns server effects, and `lib/utils.ts` exposes pure shared logic. Follow a real app's service when adding the first one. A service owns its numbered SQLite migrations; never change an existing migration.

The workspace's Fallow zones keep clients and shared contracts separate from server implementations. RPC tags name their service; public service methods have `Service.method` spans. Put async page state in atoms under a topic-named `src/lib` module. Do not add MCP tools until agents need them.

## Journeys

- Open the app, complete sign-in if configured and see the app's name.
- Background and resume; the app's name remains available.
