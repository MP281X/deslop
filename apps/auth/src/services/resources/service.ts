import {Array, Boolean, Clock, Context, Effect, Option, Record, Schema, Stream, SubscriptionRef, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {KeyValueStore} from 'effect/persistence'

import type {EnrollmentRequest} from '@deslop/runtime/auth/schema'
import {AuthError, DEFAULT_RESOURCES, Enrollment} from '@deslop/runtime/auth/schema'

function visible(row: Enrollment, now: number) {
	return row.status !== 'pending' || row.createdAt + 10 * 60_000 > now
}

export class Resources extends Context.Service<
	Resources,
	{
		readonly accepted: (resource: string) => Effect.Effect<void, AuthError>
		readonly decide: (id: string, approve: boolean, admin: string) => Effect.Effect<void, AuthError>
		readonly list: Stream.Stream<readonly Enrollment[]>
		readonly lookup: (id: string) => Effect.Effect<Enrollment, AuthError>
		readonly request: (input: EnrollmentRequest) => Effect.Effect<Enrollment, AuthError>
	}
>()('@deslop/auth/services/resources/service/Resources') {
	static readonly make = Effect.gen(function* () {
		const store = KeyValueStore.toSchemaStore(
			yield* KeyValueStore.KeyValueStore,
			Schema.Record(Schema.String, Enrollment)
		)
		const state = yield* SubscriptionRef.make(Option.getOrElse(yield* store.get('resources'), () => ({})))
		const random = yield* SecureRandom.SecureRandom
		const accepted = Effect.fnUntraced(function* (resource: string) {
			const registered = Array.findFirst(
				Record.values(yield* SubscriptionRef.get(state)),
				row => row.resource === resource || `${row.resource}/mcp` === resource
			)
			if (Option.exists(registered, row => row.status === 'approved')) return
			if (Option.isNone(registered) && Array.contains(DEFAULT_RESOURCES, resource)) return
			return yield* AuthError.make({error: 'invalid_target', message: 'An admin has not approved this resource'})
		})
		const change = Effect.fnUntraced(function* <A>(
			update: (rows: Record<string, Enrollment>) => Effect.Effect<readonly [A, Record<string, Enrollment>], AuthError>
		) {
			return yield* pipe(
				SubscriptionRef.modifyEffect(state, rows =>
					pipe(
						update(rows),
						Effect.tap(next => store.set('resources', next[1]))
					)
				),
				Effect.mapError(cause => AuthError.make({cause, message: 'Cannot save resource registration'})),
				Effect.uninterruptible
			)
		})
		return Resources.of({
			accepted,
			decide: (id, approve, admin) =>
				change(rows =>
					Effect.gen(function* () {
						const row = yield* pipe(
							Effect.fromOption(Record.get(rows, id)),
							Effect.mapError(cause => AuthError.make({cause, message: 'No resource has this registration id'}))
						)
						if (!visible(row, yield* Clock.currentTimeMillis)) {
							return yield* AuthError.make({message: 'This enrollment expired; request it again'})
						}
						return [
							undefined,
							Record.set(rows, id, {
								...row,
								approvedBy: admin,
								status: Boolean.match(approve, {onFalse: () => 'denied' as const, onTrue: () => 'approved' as const})
							})
						] as const
					})
				),
			list: Stream.mapEffect(SubscriptionRef.changes(state), rows =>
				Effect.map(Clock.currentTimeMillis, now => Array.filter(Record.values(rows), row => visible(row, now)))
			),
			lookup: Effect.fnUntraced(function* (id) {
				const row = yield* pipe(
					SubscriptionRef.get(state),
					Effect.flatMap(rows => Effect.fromOption(Record.get(rows, id))),
					Effect.mapError(cause => AuthError.make({cause, message: 'Unknown enrollment'}))
				)
				if (!visible(row, yield* Clock.currentTimeMillis)) {
					return yield* AuthError.make({message: 'This enrollment expired; request it again'})
				}
				return row
			}),
			request: input =>
				change(rows =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis
						const retained = Record.filter(rows, row => visible(row, now))
						for (const row of Record.values(retained)) {
							if (row.resource === input.resource) return [row, retained] as const
						}
						// Only unsolicited pending requests consume the bounded inbox; admin decisions are durable.
						const pending = Array.filter(Record.values(retained), row => row.status === 'pending')
						const available = Boolean.match(
							pending.length >= 256 && !Array.contains(DEFAULT_RESOURCES, input.resource),
							{
								onFalse: () => retained,
								onTrue: () =>
									Option.match(Array.head(pending), {
										onNone: () => retained,
										onSome: oldest => Record.remove(retained, oldest.id)
									})
							}
						)
						const id = Base64Url.encode(yield* random.randomBytes(24))
						const row = Enrollment.make({
							...input,
							approvedBy: '',
							createdAt: now,
							id,
							status: Boolean.match(Array.contains(DEFAULT_RESOURCES, input.resource), {
								onFalse: () => 'pending' as const,
								onTrue: () => 'approved' as const
							})
						})
						return [row, Record.set(available, id, row)] as const
					})
				)
		})
	})
}
