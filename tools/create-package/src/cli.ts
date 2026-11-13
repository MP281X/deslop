import {Schema, pipe} from 'effect'

import {Flag} from 'effect/cli'

// Every generator names its package the npm way: unscoped, lowercase and hyphenated.
export function nameFlag(description: string) {
	return pipe(
		Flag.String('name'),
		Flag.withSchema(
			Schema.String.check(
				Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, {message: 'Use an unscoped kebab-case package name.'})
			)
		),
		Flag.withDescription(description)
	)
}
