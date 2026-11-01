import {Tool, Toolkit} from 'effect/ai'

import {ChapterList, ChaptersError, ReadingUpdate} from '#services/chapters/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_chapters', {
		description: 'The current manga/webcomic chapter library and reading progress, as one snapshot.',
		failure: ChaptersError,
		success: ChapterList
	}).annotate(Tool.Readonly, true),
	Tool.make('update_reading', {
		description: 'Save the reader’s page and completion status for a known chapter.',
		failure: ChaptersError,
		parameters: ReadingUpdate
	}).annotate(Tool.Destructive, false)
)
