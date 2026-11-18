import {Array, Equal, HashMap, HashSet, Option, Order, Stream, String, pipe} from 'effect'

// A live list travels as its changes: the server diffs each new list against the last, and a client folds them back in order.
export type ListEvent<A, K extends string> = {
	readonly removed: readonly K[]
	readonly reset: boolean
	readonly upserted: readonly A[]
}

export function listEvents<A, K extends string, E, R>(lists: Stream.Stream<readonly A[], E, R>, keyOf: (item: A) => K) {
	return pipe(
		lists,
		// A slow subscriber holds only the newest pending list; the diff from the last one it got still says everything.
		Stream.buffer({capacity: 1, strategy: 'sliding'}),
		Stream.mapAccum(
			() => Option.none<readonly A[]>(),
			(previous, current) => {
				const events = Option.match(previous, {
					onNone: () => [{removed: Array.empty<K>(), reset: true, upserted: current}],
					onSome: before => {
						const kept = HashMap.fromIterable(Array.map(before, item => [keyOf(item), item] as const))
						const ids = HashSet.fromIterable(Array.map(current, keyOf))
						const removed = pipe(
							before,
							Array.map(keyOf),
							Array.filter(id => !HashSet.has(ids, id))
						)
						const upserted = Array.filter(
							current,
							// A list read again holds new objects, so an unchanged item is told apart by its value.
							item =>
								!pipe(
									kept,
									HashMap.get(keyOf(item)),
									Option.exists(old => Equal.equals(old, item))
								)
						)
						if (Array.isArrayEmpty(removed) && Array.isArrayEmpty(upserted)) return []
						return [{removed, reset: false, upserted}]
					}
				})
				return [Option.some(current), events] as const
			}
		)
	)
}

// Items the order ties sort by key, ascending, so a replaced item keeps its place; the server's SQL must break ties the same way.
export function listReducer<A, K extends string>(order: Order.Order<A>, keyOf: (item: A) => K) {
	const total = Order.combine(order, Order.mapInput(String.Order, keyOf))
	return (items: readonly A[], event: ListEvent<A, K>) => {
		if (event.reset) return Array.sort(event.upserted, total)
		const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, keyOf)])
		return Array.sort([...Array.filter(items, item => !HashSet.has(replaced, keyOf(item))), ...event.upserted], total)
	}
}
