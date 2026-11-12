import {Array, Option, Predicate, String} from 'effect'

import {visitorKeys} from 'oxc-parser'

// An oxc-parser node read by key, for code that walks any node without naming its type.
export type Node = {type: string; start: number; end: number}

export function isNode(value: unknown): value is Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

export function field(node: unknown, key: string) {
	if (!Predicate.hasProperty(node, key)) return Option.none()
	return Option.some(node[key])
}

export function nodeAt(node: Node, key: string) {
	return Option.filter(field(node, key), isNode)
}

export function nodesAt(node: Node, key: string) {
	return Array.filter(Array.ensure(Option.getOrUndefined(field(node, key))), isNode)
}

export function childrenOf(node: Node) {
	return Array.flatMap(visitorKeys[node.type] ?? [], key => nodesAt(node, key))
}

export function textOf(source: string, node: Node) {
	return String.slice(node.start, node.end)(source)
}
