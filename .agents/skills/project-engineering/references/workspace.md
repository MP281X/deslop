# Workspace

## Creation

Create applications and packages only through the registered Vite+ generators.

```bash
vp create app -- --name <name>
vp install
vp create package -- --name <name>
vp install
```

| Generator | Name input          | Derived owner or output                                                                                                                                     |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App       | Unscoped kebab-case | `@deslop/<name>`. Canonical directory. React, TanStack Router, Effect RPC, telemetry, Vite, Docker, build, publication baseline                             |
| Package   | Unscoped kebab-case | `@deslop/<name>`. Canonical directory. Manifest groups, explicit subpath exports, empty same-named Effect service tagged `@deslop/<name>/service/<Service>` |

| Topology change       | Immediate next action | Forbidden before action               |
| --------------------- | --------------------- | ------------------------------------- |
| App or package create | `vp install`          | Check, development, build, or preview |

## Generated ownership

| Concern                                                  | Owner or path                                             |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Baseline topology and configuration                      | Generator                                                 |
| Behavior change                                          | Existing responsible component                            |
| Service root                                             | `apps/<app>/src/services/<name>` or `packages/<name>/src` |
| Recreated, normalized, or duplicated generated structure | Forbidden                                                 |

`index.ts` and barrel exports are forbidden.

| Manifest edit | Requirement                                      |
| ------------- | ------------------------------------------------ |
| Direct        | Retain dependency sections and blank-line groups |
| Full upgrade  | Run the command below                            |

```bash
vp run upgrade
```

```json
{"exports": {"./schema": "./src/schema.ts", "./service": "./src/service.ts", "./lib/utils": "./src/lib/utils.ts"}}
```

Current owners are `tools/create-app`, `tools/create-package`, root workspace configuration, and package manifests and exports.
