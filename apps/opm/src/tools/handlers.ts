import {Effect, Stream, pipe} from 'effect'

import {ChaptersError} from '#services/chapters/schema.ts'
import {Chapters} from '#services/chapters/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Chapters, chapters =>
		Tools.of({
			list_chapters: Effect.fnUntraced(function* () {
				return (yield* pipe(
					Stream.runHead(chapters.changes),
					Effect.flatMap(Effect.fromOption),
					Effect.mapError(cause => ChaptersError.make({cause, message: 'The chapter library is unavailable'}))
				)).upserted
			}),
			update_reading: chapters.read
		})
	)
)
