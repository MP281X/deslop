import {Effect} from 'effect'

import {ChaptersRpcs} from './contract.ts'
import {Chapters} from './server.ts'

export const chaptersHandlers = ChaptersRpcs.toLayer(
	Effect.map(Chapters, chapters => ({'chapters.events': () => chapters.events, 'chapters.write': chapters.write}))
)
