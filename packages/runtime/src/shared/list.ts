import {Array, Equal, HashMap, HashSet, Option, Stream, pipe} from 'effect'
import type {Order} from 'effect'

// A live list travels as its changes: the server diffs each new list against the last, and a client folds them back in order.
export type ListEvent<A extends {id: string}> = {
	readonly removed: readonly A['id'][]
	readonly reset: boolean
	readonly upserted: readonly A[]
}

export function listEvents<A extends {id: string}, E, R>(lists: Stream.Stream<readonly A[], E, R>) {
	return Stream.mapAccum(
		lists,
		() => Option.none<readonly A[]>(),
		(previous, current) => {
			const events = Option.match(previous, {
				onNone: () => [{removed: Array.empty<A['id']>(), reset: true, upserted: current}],
				onSome: before => {
					const kept = HashMap.fromIterable(Array.map(before, item => [item.id, item] as const))
					const ids = HashSet.fromIterable(Array.map(current, item => item.id))
					const removed = pipe(before, Array.map(item => item.id), Array.filter(id => !HashSet.has(ids, id)))
					const upserted = Array.filter(
						current,
						// A list read again holds new objects, so an unchanged item is told apart by its value.
						item => !pipe(kept, pipelineSubject1187 => HashMap.get(pipelineSubject1187, item.id), Option.exists(old => Equal.equals(old, item)))
					)
					if (Array.isArrayEmpty(removed) && Array.isArrayEmpty(upserted)) return []
					return [{removed, reset: false, upserted}]
				}
			})
			return [Option.some(current), events] as const
		}
	)
}

export function listReducer<A extends {id: string}>(order: Order.Order<A>) {
	return (items: readonly A[], event: ListEvent<A>) => {
		if (event.reset) return Array.sort(event.upserted, order)
		const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, item => item.id)])
		return Array.sort([...Array.filter(items, item => !HashSet.has(replaced, item.id)), ...event.upserted], order)
	}
}
