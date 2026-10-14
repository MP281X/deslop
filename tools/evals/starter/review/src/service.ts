import {Array, Config, Context, Effect, FileSystem, Layer, Path, Schema, Stream, pipe} from 'effect'

import {ImportError, Progress, Row} from '#schema'

export class Importer extends Context.Service<
	Importer,
	{readonly import: (file: string) => Stream.Stream<Progress, ImportError>}
>()('@deslop/importer/service/Importer') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const directory = yield* pipe(Config.String('DATA_DIRECTORY'), Config.withDefault('data'))
			yield* fs.makeDirectory(directory, {recursive: true})
			const files = Effect.fnUntraced(function* (input: string) {
				if ((yield* fs.stat(input)).type !== 'Directory') return [input]
				return Array.map(yield* fs.glob('*.json', {root: input}), file => path.join(input, file))
			})
			const read = Effect.fnUntraced(function* (file: string) {
				return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Row)))(
					yield* Stream.mkString(Stream.decodeText(fs.stream(file)))
				)
			})
			return {
				import: input =>
					pipe(
						Stream.fromEffect(files(input)),
						Stream.flatMap(paths => Stream.fromIterable(paths)),
						Stream.flatMap(file =>
							pipe(
								Stream.fromEffect(read(file)),
								Stream.flatMap(rows => Stream.fromIterable(rows)),
								Stream.flatMap(row =>
									Stream.concat(
										Stream.succeed(Progress.make({file, id: row.id})),
										pipe(
											Stream.fromEffect(Effect.gen(function* () {
												yield* fs.writeFileString(
													path.join(directory, `${row.id}.json`),
													yield* Schema.encodeEffect(Schema.fromJsonString(Row))(row)
												)
											})),
											Stream.drain
										)
									)
								)
							)
						),
						Stream.mapError(cause => ImportError.make({cause, message: 'Cannot import records'}))
					)
			}
		})
	)
}
