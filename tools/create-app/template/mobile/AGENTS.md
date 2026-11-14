# template-app

An authenticated iOS app with a binary RPC server. Keep its product intent here as features are added.

Services live in `src/services/<name>/`: `schema.ts` defines shared contracts, `service.ts` owns server effects, and `lib/utils.ts` exposes pure shared logic. Follow a real app's service when adding the first one. A service owns its numbered SQLite migrations; never change an existing migration.

Put async page state in atoms under a topic-named `src/lib` module.
