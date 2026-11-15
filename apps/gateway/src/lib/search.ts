import {Schema} from 'effect'

import {TimeFrame} from '@deslop/runtime/shared/time'

export type Search = typeof Search.Type
// The period is the page's only view state; the default is the last day.
export const Search = Schema.Struct({period: Schema.OptionFromOptionalKey(TimeFrame)})
