# Test Placement

| Behavior                           | Owner                        |
| ---------------------------------- | ---------------------------- |
| Package service or helper          | Colocated `name.test.ts`     |
| Application service                | `apps/<app>/src/services/**` |
| Effect RPC contract and handler    | Application RPC test         |
| Rendered interaction and visual UX | Browser acceptance           |

Test Effect RPC through `RpcTest.makeClient(group)` with the handler Layer and every declared middleware service. Do not replace the in-memory no-serialization seam with a live transport.
