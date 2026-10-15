import {Array, Option, Predicate, Record, pipe} from 'effect'

import type {CreatedDirectory, CreatedEntry, IntakeDirectory} from 'bingo-fs'

export function replaceDirectory(directory: IntakeDirectory, replace: (content: string) => string): CreatedDirectory {
	return pipe(
		directory,
		Record.filter(Predicate.isNotUndefined),
		Record.map(entry => {
			if (!Array.isArray(entry)) return replaceDirectory(entry, replace)

			const replaced = replace(entry[0])
			return Option.match(Option.fromUndefinedOr(entry[1]), {
				onNone: () => [replaced] satisfies CreatedEntry,
				onSome: options => [replaced, options] satisfies CreatedEntry
			})
		})
	)
}
