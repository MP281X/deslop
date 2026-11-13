import {Schema, Struct} from 'effect'

import {defaultStringifySearch} from '@tanstack/react-router'

import {Period} from '#services/usage/schema.ts'

export type Search = typeof Search.Type
// The period is the page's only view state; the default is the last week.
export const Search = Schema.Struct({period: Schema.OptionFromOptionalKey(Period)})

// TanStack serializes both raw parsed search and validated search. Only the latter carries Options.
export function searchStringOf(search: Record<string, unknown>) {
	if (Schema.is(Search)(search)) {
		return defaultStringifySearch({...Struct.omit(search, ['period']), ...Schema.encodeSync(Search)(search)})
	}
	return defaultStringifySearch(search)
}
