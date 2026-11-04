import {Schema, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

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

// The program that runs a generator's command, described and versioned by the package beside its bundle; its bin provides the entry point's services.
export function generatorProgram<Name extends string, Input, E, R>(options: {
	command: Command.Command<Name, Input, Record<never, never>, E, R>
	description: string
	version: string
}) {
	return pipe(options.command, Command.withDescription(options.description), Command.run({version: options.version}))
}
