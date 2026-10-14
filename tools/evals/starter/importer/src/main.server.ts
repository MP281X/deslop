// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer needs Node's HTTP server constructor.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Config, Effect, FileSystem, Layer, Path, Schema, Stream, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Row} from '#schema'
import {Importer} from '#service'

const routes = HttpRouter.use(router =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = yield* pipe(Config.String('DATA_DIRECTORY'), Config.withDefault('data'))
		yield* router.add('GET', '/', Effect.map(fs.readFileString('index.html'), HttpServerResponse.html))
		yield* router.add(
			'POST',
			'/imports',
			Effect.gen(function* () {
				return yield* HttpServerResponse.json({
					imported: (yield* Stream.runCollect(
						(yield* Importer).import(
							(yield* HttpServerRequest.schemaBodyJson(Schema.Struct({file: Schema.String}))).file
						)
					)).length
				})
			})
		)
		yield* router.add(
			'GET',
			'/records',
			Effect.gen(function* () {
				return yield* HttpServerResponse.json(
					yield* Effect.forEach(Array.filter(yield* fs.readDirectory(directory), String.endsWith('.json')), file =>
						Effect.flatMap(
							fs.readFileString(path.join(directory, file)),
							Schema.decodeEffect(Schema.fromJsonString(Row))
						)
					)
				)
			})
		)
	})
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(routes),
		Layer.provide(Importer.layer),
		Layer.provide(NodeServices.layer),
		Layer.provide(
			NodeHttpServer.layerConfig(createServer, {
				host: Config.succeed('127.0.0.1'),
				port: pipe(Config.Port('PORT'), Config.withDefault(5000))
			})
		),
		Layer.launch
	)
)
