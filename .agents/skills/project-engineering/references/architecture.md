# Application Architecture

| Owner                         | Responsibility                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Server                        | Authoritative application state                                                           |
| Effect RPC                    | Every frontend/backend operation and stream                                               |
| `@deslop/runtime/client`      | RPC transport, `#root` lookup, and global TanStack Router options                         |
| `apps/<app>/src/lib/utils.ts` | Application `RpcClient` `AtomRpc.Service` using the shared runtime transport              |
| Application entrypoint        | Call `ClientRuntime.makeRouter(routeTree)`, register its router type, render its provider |

## Placement

| Concern                                           | Owner                              |
| ------------------------------------------------- | ---------------------------------- |
| Frontend-safe schemas, associated types, errors   | `<service>/schema.ts`              |
| Frontend-safe pure service operations             | `<service>/lib/utils.ts`           |
| Service interface and exposed Layers              | `<service>/service.ts`             |
| Private implementation or backend dependencies    | `<service>/internal/*`             |
| Application RPC group                             | `apps/<app>/src/rpcs/contracts.ts` |
| Application RPC implementation                    | `apps/<app>/src/rpcs/handlers.ts`  |
| Client Atom RPC runtime and shared app operations | `apps/<app>/src/lib/utils.ts`      |
| Server entry module and complete Layer graph      | `apps/<app>/src/main.server.ts`    |

The service class owns its public interface and named Layers. Constructors under `internal/*` infer requirements, errors, and output through `Service.of`. Consumers do not define parallel service shapes or assemble implementation Layers.

## Real-Time State

Expose authoritative server state as an Effect RPC stream. Synchronize its latest emission with a kept-alive Atom instead of pull-oriented query batches or component-owned subscriptions.

```ts
export const notesAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('notes.changes', undefined)),
			Stream.unwrap
		)
	)
)
```

RPC callbacks delegate directly when no lookup or sequencing is required. Use `Effect.fnUntraced` and `Stream.unwrap` only when constructing a stream through Effectful lookup. The RPC runtime owns transport spans and infinite stream tracing. Handlers do not add duplicate spans.
