import {Schema} from 'effect'

import {Period} from '#services/usage/schema.ts'

export type Search = typeof Search.Type
// The period is the page's only view state; the default is the last week.
export const Search = Schema.Struct({period: Schema.OptionFromOptionalKey(Period)})
