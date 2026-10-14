import {Config, Context, Effect, FileSystem, Layer, Path, Schema, Stream, pipe} from 'effect'

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
			const read = Effect.fnUntraced(function* (file: string) {
				return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Row)))(
					yield* Stream.mkString(Stream.decodeText(fs.stream(file)))
				)
			})
			return {
				import: file =>
					pipe(
						Stream.fromEffect(read(file)),
						Stream.flatMap(rows => Stream.fromIterable(rows)),
						Stream.mapEffect(
							Effect.fnUntraced(function* (row) {
								yield* fs.writeFileString(
									path.join(directory, `${row.id}.json`),
									yield* Schema.encodeEffect(Schema.fromJsonString(Row))(row)
								)
								return Progress.make({file, id: row.id})
							})
						),
						Stream.mapError(cause => ImportError.make({cause, message: 'Cannot import records'}))
					)
			}
		})
	)
}
