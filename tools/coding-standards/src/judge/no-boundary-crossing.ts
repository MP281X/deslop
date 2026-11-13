import {changeQuestion} from '#lib/question.ts'

export const noBoundaryCrossing = changeQuestion(
	'change',
	'Does `change`, the whole diff of what `request` asks for, put work on the wrong side of a boundary even though every import it uses is allowed: work a service owns done in a route, component or screen; server work done in a web or native client; one app doing what another app answers; or one service reaching into another service’s internals instead of its schema, service and utils? `context` lists lines outside the diff that declare or use the names `request` mentions.',
	{
		message: 'Move the work to the side that owns it and call it from there; the boundary stays where it is.',
		no: {
			cases: [
				'Work that stays with its owner, such as a route reading an atom or calling an action the service answers',
				'A move toward the owner, removing the work from the wrong side',
				'Configuration, documentation, tests and generated files',
				'An import of a side, a service file or another app that lint already reports'
			],
			example: {
				change: `
					Changed files:
					M apps/trips/src/services/live-activities/service.ts

					=== apps/trips/src/services/live-activities/service.ts
					@@ -40,6 +40,8 @@ export class LiveActivities extends Context.Service<
					 			start: Effect.fn('LiveActivities.start')(function* (trip: Trip) {
					+				const token = yield* tokens.pushToStart(trip.userId)
					+				yield* apns.send(token, {event: 'start', state: stateOf(trip)})
					 			}),
				`,
				context: '',
				request: 'Trips starts the Live Activity on the morning a trip departs'
			}
		},
		yes: {
			cases: [
				'A component, route or screen that starts, schedules or retries work a service owns, such as a Live Activity, a sync or a refresh policy',
				'A client deciding what only the server can know, such as which rows a person may see',
				'Code in one service or app that reads another’s private tables, files or helpers'
			],
			example: {
				change: `
					Changed files:
					M apps/trips/src/routes/trip.tsx

					=== apps/trips/src/routes/trip.tsx
					@@ -12,6 +12,9 @@ function TripScreen(props: {trip: Trip}) {
					 	const trip = useAtomValue(tripAtom(props.trip.id))
					+	useEffect(() => {
					+		if (trip.departsToday) LiveActivity.start({title: trip.name, state: stateOf(trip)})
					+	}, [trip.departsToday])
					 	return <TripDays trip={trip} />
				`,
				context: '',
				request: 'Trips starts the Live Activity on the morning a trip departs'
			}
		}
	}
)
