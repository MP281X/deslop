import {changeQuestion} from '#lib/question.ts'

export const noBoundaryCrossing = changeQuestion(
	'edit',
	'Does `edit`, a hunk of the change to `file`, put work on the wrong side of a boundary even though every import it uses is allowed: work a service owns done in a route, component or screen; server work done in a web or native client; one app doing what another app answers; or one service reaching into another service’s internals instead of its schema, service and utils?',
	{
		message: 'Move the work to the side that owns it and call it from here; the boundary stays where it is.',
		no: {
			cases: [
				'Work that stays with its owner, such as a route reading an atom or calling an action the service answers',
				'A move the hunk makes toward the owner, removing the work from the wrong side',
				'Configuration, documentation, tests and generated files',
				'An import of a side, a service file or another app that lint already reports'
			],
			example: {
				edit: `
					@@ export class LiveActivities extends Context.Service<
					 			start: Effect.fn('LiveActivities.start')(function* (trip: Trip) {
					+				const token = yield* tokens.pushToStart(trip.userId)
					+				yield* apns.send(token, {event: 'start', state: stateOf(trip)})
					 			}),
				`,
				file: 'apps/trips/src/services/live-activities/service.ts'
			}
		},
		yes: {
			cases: [
				'A component, route or screen that starts, schedules or retries work a service owns, such as a Live Activity, a sync or a refresh policy',
				'A client deciding what only the server can know, such as which rows a person may see',
				'Code in one service or app that reads another’s private tables, files or helpers'
			],
			example: {
				edit: `
					@@ function TripScreen(props: {trip: Trip}) {
					 	const trip = useAtomValue(tripAtom(props.trip.id))
					+	useEffect(() => {
					+		if (trip.departsToday) LiveActivity.start({title: trip.name, state: stateOf(trip)})
					+	}, [trip.departsToday])
					 	return <TripDays trip={trip} />
				`,
				file: 'apps/trips/src/routes/trip.tsx'
			}
		}
	}
)
