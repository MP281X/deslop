import {
	Array,
	Boolean,
	Clock,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	MutableHashMap,
	Number,
	Option,
	Record,
	Schedule,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {hasMeaningfulMove} from './lib/utils.ts'
import type {Command, GuestKey, JoinVisitor, MoveVisitor, RecolorVisitor, Scene, Visitors} from './schema.ts'
import {Color, PresenceError, Visitor, VisitorId} from './schema.ts'

// The least time between two of a socket's commands: a cursor moves 20 times a second; a colour, picked by key press, changes 4.
const SPACING = {move: 50, recolor: 250}

const SERVER_BOTS = [
	{
		color: Color.literals[3],
		id: VisitorId.make('server-alpha'),
		name: 'server-alpha',
		xFreq: 0.47,
		xPhase: 0,
		yFreq: 0.71,
		yPhase: 0
	},
	{
		color: Color.literals[5],
		id: VisitorId.make('server-beta'),
		name: 'server-beta',
		xFreq: 0.83,
		xPhase: Math.PI,
		yFreq: 0.53,
		yPhase: Math.PI / 2
	}
] as const

export class Presence extends Context.Service<
	Presence,
	{
		readonly join: (payload: JoinVisitor, connection: number) => Stream.Stream<Scene, PresenceError>
		readonly move: (payload: MoveVisitor, connection: number) => Effect.Effect<void, PresenceError>
		readonly recolor: (payload: RecolorVisitor, connection: number) => Effect.Effect<void, PresenceError>
	}
>()('@deslop/portfolio/services/presence/service/Presence') {
	static readonly layer = Layer.effect(
		this,
		// Visitor state should not outlive the running room.
		Effect.gen(function* () {
			const start = yield* DateTime.now
			const random = yield* SecureRandom.SecureRandom
			// At most 128 visitors and 256 joined sockets; each socket owns one cursor identity and its own command budget.
			const connections = MutableHashMap.empty<number, {id: VisitorId; key: GuestKey; last: Record<Command, number>}>()
			// One cursor per guest key; a visitor remains until its last tab closes.
			const room = yield* SubscriptionRef.make<{
				bots: Visitors
				guests: Record<GuestKey, {id: VisitorId; tabs: number}>
				visitors: Visitors
			}>({bots: [], guests: {}, visitors: []})
			// What every joined socket reads: the room at most once per 50 ms, however many cursors changed in between.
			const published = yield* SubscriptionRef.make<{bots: Visitors; visitors: Visitors}>({bots: [], visitors: []})
			const wander = Stream.fromEffectSchedule(
				Effect.map(DateTime.now, now =>
					Array.map(SERVER_BOTS, bot =>
						Visitor.make({
							color: bot.color,
							id: bot.id,
							name: bot.name,
							x: Number.clamp(
								0.5 + 0.4 * Math.sin(Duration.toSeconds(DateTime.distance(start, now)) * bot.xFreq + bot.xPhase),
								{maximum: 0.995, minimum: 0.005}
							),
							y: Number.clamp(
								0.5 + 0.4 * Math.cos(Duration.toSeconds(DateTime.distance(start, now)) * bot.yFreq + bot.yPhase),
								{maximum: 0.995, minimum: 0.005}
							)
						})
					)
				),
				Schedule.spaced('55 millis')
			)
			// One untraced timer for the room, interrupted as soon as the last tab leaves.
			yield* pipe(
				SubscriptionRef.changes(room),
				Stream.map(scene => !Array.isReadonlyArrayEmpty(scene.visitors)),
				Stream.changes,
				Stream.switchMap(occupied => Boolean.match(occupied, {onFalse: () => Stream.empty, onTrue: () => wander})),
				Stream.runForEach(bots =>
					SubscriptionRef.updateSome(room, scene => {
						if (Array.isReadonlyArrayEmpty(scene.visitors)) return Option.none()
						return Option.some({...scene, bots})
					})
				),
				Effect.forkScoped
			)
			yield* pipe(
				SubscriptionRef.changes(room),
				Stream.map(scene => ({bots: scene.bots, visitors: scene.visitors})),
				// A second tab of a present guest changes no cursor.
				Stream.changesWith((previous, next) => previous.bots === next.bots && previous.visitors === next.visitors),
				Stream.buffer({capacity: 1, strategy: 'sliding'}),
				Stream.throttle({cost: Array.length, duration: '50 millis', units: 1}),
				Stream.runForEach(scene => SubscriptionRef.set(published, scene)),
				Effect.forkScoped
			)

			// The joined socket's cursor, once its budget for this command allows another.
			const admit = Effect.fnUntraced(function* (connection: number, command: Command) {
				const joined = Option.getOrUndefined(MutableHashMap.get(connections, connection))
				if (joined === undefined) return yield* PresenceError.make({message: 'Join the room first'})
				const now = yield* Clock.currentTimeMillis
				if (now - joined.last[command] < SPACING[command]) {
					return yield* PresenceError.make({message: 'Cursor changes are arriving too fast'})
				}
				joined.last[command] = now
				return joined.id
			})

			return Presence.of({
				join: (payload, connection) =>
					// A connection's trace should include its departure, not just admission.
					Stream.withSpan(
						Stream.unwrap(
							Effect.gen(function* () {
								// 48 random bits: unique among 128 visitors and unrelated to the key.
								const fresh = VisitorId.make(
									`v-${String.slice(0, 12)(String.replace('-', '')(yield* random.uuidV4()))}`
								)
								const admitted = yield* Effect.acquireRelease(
									SubscriptionRef.modify(room, scene => {
										const guest = Record.get(scene.guests, payload.key)
										if (
											MutableHashMap.has(connections, connection) ||
											MutableHashMap.size(connections) >= 256 ||
											(Option.isNone(guest) && scene.visitors.length >= 128)
										) {
											return [Option.none(), scene]
										}
										const id = Option.match(guest, {onNone: () => fresh, onSome: present => present.id})
										MutableHashMap.set(connections, connection, {
											id,
											key: payload.key,
											last: {move: -Infinity, recolor: -Infinity}
										})
										return [
											Option.some(id),
											{
												...scene,
												guests: {
													...scene.guests,
													[payload.key]: {
														id,
														tabs: Option.match(guest, {
															onNone: Function.constant(1),
															onSome: present => present.tabs + 1
														})
													}
												},
												visitors: Boolean.match(Option.isNone(guest), {
													onFalse: () => scene.visitors,
													onTrue: () =>
														Array.append(
															scene.visitors,
															Visitor.make({color: payload.color, id, name: payload.name, x: 0.5, y: 0.5})
														)
												})
											}
										]
									}),
									Option.match({
										onNone: () => Effect.void,
										onSome: id =>
											SubscriptionRef.update(room, scene => {
												MutableHashMap.remove(connections, connection)
												return pipe(
													scene.guests,
													Record.get(payload.key),
													Option.match({
														onNone: () => scene,
														onSome: guest => {
															if (guest.tabs > 1) {
																return {...scene, guests: {...scene.guests, [payload.key]: {id, tabs: guest.tabs - 1}}}
															}
															const visitors = Array.filter(scene.visitors, visitor => visitor.id !== id)
															return {
																bots: Boolean.match(Array.isReadonlyArrayEmpty(visitors), {
																	onFalse: () => scene.bots,
																	onTrue: () => []
																}),
																guests: Record.remove(scene.guests, payload.key),
																visitors
															}
														}
													})
												)
											})
									})
								)
								return yield* Option.match(admitted, {
									onNone: () =>
										Effect.fail(PresenceError.make({message: 'Room capacity reached or connection already joined'})),
									onSome: id =>
										Effect.as(
											Effect.annotateCurrentSpan('visitorId', id),
											pipe(
												SubscriptionRef.changes(published),
												Stream.map(scene => ({...scene, own: id})),
												Stream.buffer({capacity: 1, strategy: 'sliding'})
											)
										)
								})
							})
						),
						'Presence.join',
						{attributes: {'rpc.stream': true}}
					),
				// oxlint-disable-next-line @deslop/coding-standards/service-method-span -- Anyone may send 20 moves a second per socket, and a span each would flood Scope as RPC spans did before #255; the join's span records the visit.
				move: Effect.fnUntraced(function* (payload, connection) {
					const id = yield* admit(connection, 'move')
					yield* SubscriptionRef.updateSome(room, scene =>
						pipe(
							scene.visitors,
							Array.findFirstIndex(visitor => visitor.id === id && hasMeaningfulMove(visitor, payload)),
							Option.map(index => ({
								...scene,
								visitors: Array.map(scene.visitors, (visitor, position) => {
									if (position === index) return {...visitor, x: payload.x, y: payload.y}
									return visitor
								})
							}))
						)
					)
				}),
				// oxlint-disable-next-line @deslop/coding-standards/service-method-span -- A public command beside move, kept out of Scope for the same reason.
				recolor: Effect.fnUntraced(function* (payload, connection) {
					const id = yield* admit(connection, 'recolor')
					yield* SubscriptionRef.updateSome(room, scene => {
						if (!Array.some(scene.visitors, visitor => visitor.id === id && visitor.color !== payload.color)) {
							return Option.none()
						}
						return Option.some({
							...scene,
							visitors: Array.map(scene.visitors, visitor => {
								if (visitor.id === id) return {...visitor, color: payload.color}
								return visitor
							})
						})
					})
				})
			})
		})
	)
}
