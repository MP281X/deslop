// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite and NodeHttpServer expose native Node request/response boundary types.
import type {IncomingMessage, ServerResponse} from 'node:http'
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite's upgrade event exposes the native Node socket type.
import type {Duplex} from 'node:stream'

import type {NodeServices} from '@effect/platform-node'
import {NodeHttpServer, NodeSocket} from '@effect/platform-node'

import {
	Array,
	Cause,
	Context,
	Effect,
	Equal,
	Exit,
	Layer,
	Option,
	Predicate,
	Record,
	Scope,
	Semaphore,
	String,
	pipe
} from 'effect'

import {HttpRouter, HttpServer} from 'effect/unstable/http'
import type {Connect, EnvironmentModuleNode, Plugin} from 'vite'
import {isRunnableDevEnvironment} from 'vite'

const isApiUrl = Predicate.compose(
	String.isString,
	Predicate.or(Equal.equals('/api'), Predicate.or(String.startsWith('/api/'), String.startsWith('/api?')))
)

export function serverPlugin(): Plugin {
	let active = Option.none<{
		request: (request: IncomingMessage, response: ServerResponse) => void
		scope: Scope.Scope
		upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
	}>()
	let pendingReplacement = false
	let reloadBackend = Effect.void
	const reloadLock = Semaphore.makeUnsafe(1)
	const runFork = Effect.runForkWith(Context.empty())
	const runPromise = Effect.runPromiseWith(Context.empty())

	const close = Effect.suspend(() => {
		if (Option.isNone(active)) return Effect.void
		const scope = active.value.scope
		active = Option.none()
		return Scope.close(scope, Exit.void)
	})
	return {
		closeBundle: () => runPromise(reloadLock.withPermit(close)),
		config: () => ({
			environments: {server: {}},
			server: {
				hotUpdateEnvironments(server, hotUpdate) {
					return runPromise(
						Effect.gen(function* () {
							yield* Effect.forEach(
								Record.values(server.environments),
								environment => Effect.promise(() => hotUpdate(environment)),
								{concurrency: 'unbounded', discard: true}
							)
							if (!pendingReplacement) return
							pendingReplacement = false
							yield* reloadLock.withPermit(reloadBackend)
						})
					)
				}
			}
		}),
		configureServer: server => {
			const environment = server.environments['server']
			const httpServer = server.httpServer
			if (Predicate.isUndefined(environment) || !isRunnableDevEnvironment(environment)) {
				throw new TypeError('Vite environment "server" must be runnable')
			}
			if (Predicate.isNull(httpServer)) throw new TypeError('Vite must own an HTTP server')
			const runnableEnvironment = environment
			const viteServer = httpServer

			reloadBackend = pipe(
				Effect.gen(function* () {
					yield* close
					runnableEnvironment.runner.clearCache()
					const application = yield* Effect.tryPromise(() =>
						runnableEnvironment.runner.import<{
							default: Layer.Layer<never, never, HttpServer.HttpServer | NodeServices.NodeServices>
						}>('src/main.server.ts')
					)
					const address = viteServer.address()
					if (Predicate.isNull(address) || Predicate.isString(address)) {
						return yield* Effect.die('Vite HTTP server is not listening on TCP')
					}
					const scope = yield* Scope.make()
					return yield* pipe(
						Effect.gen(function* () {
							const webSocketServer = yield* Effect.acquireRelease(
								Effect.sync(() => new NodeSocket.NodeWS.WebSocketServer({noServer: true})),
								socketServer =>
									Effect.callback<true>(resume => {
										socketServer.close(() => {
											resume(Effect.succeed(true))
										})
									})
							)
							const httpEffect = yield* HttpRouter.toHttpEffect(application.default)
							active = Option.some({
								request: yield* NodeHttpServer.makeHandler(httpEffect, {scope}),
								scope,
								upgrade: yield* NodeHttpServer.makeUpgradeHandler(Effect.succeed(webSocketServer), httpEffect, {scope})
							})
						}),
						Scope.provide(scope),
						// @effect-diagnostics-next-line strictEffectProvide:off -- The dynamically loaded server application receives its complete platform layer here.
						Effect.provide(
							Layer.merge(
								NodeHttpServer.layerHttpServices,
								Layer.succeed(HttpServer.HttpServer)(
									HttpServer.make({
										address: {_tag: 'TcpAddress', hostname: '0.0.0.0', port: address.port},
										serve: () => Effect.void
									})
								)
							)
						),
						Effect.onError(() => Scope.close(scope, Exit.void))
					)
				}),
				Effect.catchCause(cause =>
					Effect.sync(() => {
						server.config.logger.error(`Backend unavailable\n${Cause.pretty(cause)}`)
					})
				)
			)

			viteServer.once('listening', () => {
				runFork(reloadLock.withPermit(reloadBackend))
			})
			server.middlewares.use((request: Connect.IncomingMessage, response, next) => {
				if (!isApiUrl(request.url)) {
					next()
					return
				}
				if (Option.isNone(active)) {
					response.writeHead(503).end()
					return
				}
				active.value.request(request, response)
			})
			viteServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
				if (!isApiUrl(request.url)) return
				if (Option.isNone(active)) {
					socket.destroy()
					return
				}
				active.value.upgrade(request, socket, head)
			})
		},
		hotUpdate: {
			handler(options) {
				if (this.environment.name === 'client') {
					const serverModules = options.server.environments['server']?.moduleGraph.getModulesByFile(options.file)
					const clientOwnsFile = Array.some(
						options.modules,
						module => Predicate.isNotNull(module.id) && module.file === options.file
					)
					if (serverModules !== undefined && serverModules.size > 0 && !clientOwnsFile) return []
					return
				}
				if (this.environment.name !== 'server' || Array.isReadonlyArrayEmpty(options.modules)) return
				// oxlint-disable-next-line eslint/no-restricted-globals -- Vite's module-graph API requires a native Set instance.
				const invalidated = new Set<EnvironmentModuleNode>()
				for (const module of options.modules) {
					this.environment.moduleGraph.invalidateModule(module, invalidated, options.timestamp, true)
				}
				pendingReplacement = true
				return []
			},
			order: 'post'
		},
		name: '@deslop/runtime/server'
	}
}
