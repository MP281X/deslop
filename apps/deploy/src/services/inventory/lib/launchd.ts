import {Array, Effect, Number, Option, Schema, String} from 'effect'

// Deslop's apps from `launchctl list`: each runs as the launch agent `deslop-<app>`, whose `deslop-<app>-update` agent only updates it. `pid` is `-` while an agent is not running; `status`, the last exit status, is always printed, so a listing whose status is not a whole number fails.
export const launchAgents = Effect.fnUntraced(function* (text: string) {
	return yield* Effect.forEach(
		Array.getSomes(
			Array.map(Array.drop(String.split(String.trim(text), '\n'), 1), line => {
				const [pid, status, label] = String.split(line, '\t')
				return Option.map(
					Option.liftPredicate(
						label ?? '',
						name => String.startsWith('deslop-')(name) && !String.endsWith('-update')(name)
					),
					name => ({label: name, pid: Number.parse(pid), status: status ?? ''})
				)
			})
		),
		agent =>
			Effect.map(Schema.decodeEffect(Schema.FiniteFromString.check(Schema.isInt()))(agent.status), status => ({
				...agent,
				status
			})),
		{concurrency: 'unbounded'}
	)
})
