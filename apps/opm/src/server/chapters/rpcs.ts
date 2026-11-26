import {Effect} from 'effect'

import {ChapterRpcs} from '#contracts'

import {Chapters} from '#server/chapters/service.ts'

export const ChapterHandlers = ChapterRpcs.toLayer(
	Effect.map(Chapters, chapters => ({'chapters.events': () => chapters.events, 'chapters.write': chapters.write}))
)
