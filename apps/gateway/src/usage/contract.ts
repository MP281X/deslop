import {Schema} from 'effect'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis} from '@deslop/runtime/shared/time'

export type UsageRange = typeof UsageRange.Type
export const UsageRange = Schema.Struct({
	count: Schema.Finite,
	from: DateTimeUtcFromFiniteMillis,
	size: DurationFromFiniteMillis,
	to: DateTimeUtcFromFiniteMillis
})
