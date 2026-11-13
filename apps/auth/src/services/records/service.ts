import {DateTime, Duration, Effect, HashMap, Option, Stream, SubscriptionRef, pipe} from 'effect'

export type TransientRecord<V> = {expiresAt: DateTime.Utc; value: V}

// A restart cancels transient records; their streams observe expiry without a timer per record.
export const makeRecords = Effect.fnUntraced(function* <K, V>(lifetime: Duration.Duration) {
	const records = yield* SubscriptionRef.make(HashMap.empty<K, TransientRecord<V>>())
	const current = Effect.flatMap(DateTime.now, now =>
		SubscriptionRef.modifySome(records, entries => {
			const live = HashMap.filter(entries, entry => DateTime.isGreaterThan(entry.expiresAt, now))
			return [live, Option.liftPredicate(live, remaining => HashMap.size(remaining) !== HashMap.size(entries))]
		})
	)
	function get(key: K) {
		return Effect.map(current, entries => HashMap.get(entries, key))
	}
	return {
		changes: pipe(
			SubscriptionRef.changes(records),
			Stream.merge(Stream.mapEffect(Stream.tick(Duration.seconds(1)), () => current)),
			Stream.mapEffect(() => current)
		),
		// Authorization-code receipts keep the issued family until the original expiry, so replay revokes it.
		consume: Effect.fnUntraced(function* (key: K, receipt: Option.Option<V>) {
			yield* current
			return yield* SubscriptionRef.modify(records, entries => [
				HashMap.get(entries, key),
				Option.match(receipt, {
					onNone: () => HashMap.remove(entries, key),
					onSome: value => HashMap.modify(entries, key, entry => ({...entry, value}))
				})
			])
		}),
		create: Effect.fnUntraced(function* (key: K, value: V) {
			yield* current
			const entry = {expiresAt: DateTime.addDuration(yield* DateTime.now, lifetime), value}
			yield* SubscriptionRef.update(records, HashMap.set(key, entry))
			return entry
		}),
		get,
		remove: (key: K) => SubscriptionRef.update(records, HashMap.remove(key)),
		update: (key: K, f: (value: V) => V) =>
			Effect.andThen(
				current,
				SubscriptionRef.update(
					records,
					HashMap.modify(key, entry => ({...entry, value: f(entry.value)}))
				)
			),
		values: Effect.map(current, HashMap.toValues)
	}
})
