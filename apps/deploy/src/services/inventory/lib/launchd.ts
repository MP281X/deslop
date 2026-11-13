import {Array, Effect, Number, Option, Schema, String, pipe} from 'effect'

import {ProcessId, UnitId} from '#services/inventory/schema.ts'

// Deslop's apps from `launchctl list`: each runs as the launch agent `deslop-<app>`, whose `deslop-<app>-update` agent only updates it. `pid` is `-` while an agent is not running; `status`, the last exit status, is always printed, so a listing whose status is not a whole number fails.
export const launchAgents = Effect.fnUntraced(function* (text: string) {
	return yield* Effect.forEach(
		Array.getSomes(
			Array.map(pipe(String.trim(text), String.split('\n'), Array.drop(1)), line => {
				const [pid, status, label] = String.split(line, '\t')
				return pipe(
					label ?? '',
					Option.liftPredicate(name => String.startsWith('deslop-')(name) && !String.endsWith('-update')(name)),
					Option.map(name => ({
						label: Schema.decodeSync(UnitId)(name),
						pid: Option.flatMap(Number.parse(pid), Schema.decodeOption(ProcessId)),
						status: status ?? ''
					}))
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
