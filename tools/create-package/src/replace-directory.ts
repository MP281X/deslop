import {Array, Predicate, Record, pipe} from 'effect'

import type {CreatedDirectory, CreatedEntry, IntakeDirectory} from 'bingo-fs'

export function replaceDirectory(directory: IntakeDirectory, replace: (content: string) => string): CreatedDirectory {
	return pipe(
		directory,
		Record.filter(Predicate.isNotUndefined),
		Record.map((entry): CreatedEntry => {
			if (!Array.isArray(entry)) return replaceDirectory(entry, replace)

			const replaced = replace(entry[0])
			return Predicate.isUndefined(entry[1]) ? [replaced] : [replaced, entry[1]]
		})
	)
}
