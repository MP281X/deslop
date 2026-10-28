import {Array, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {matches, memberName, memberRoot, variableFor} from '#rules/shared.ts'

// The compiler's preferEffectArray and preferEffectString own string methods and mapped array methods such as map; this rule keeps the array methods they skip and Promise chains.
const REPLACEMENTS: Record.ReadonlyRecord<string, string> = {
	at: 'Array.get or String.at',
	catch: 'Effect.tryPromise and Effect.catchTag',
	concat: 'Array.appendAll or String.concat',
	entries: 'Array.map(items, (item, index) => [index, item]), Record.toEntries or HashMap.entries',
	fill: 'Array.replicate or Array.makeBy',
	finally: 'Effect.ensuring',
	flat: 'Array.flatten',
	includes:
		'Array.contains for structural equality, Array.containsWith(Equivalence.strictEqual()) for identity, or String.includes',
	indexOf: 'Array.findFirstIndex or String.indexOf',
	keys: 'Record.keys or HashMap.keys',
	lastIndexOf: 'Array.findLastIndex or String.lastIndexOf',
	pop: 'Array.last and Array.dropRight',
	push: 'Array.append, or MutableList.append for a local append-only collector consumed at the end',
	reverse: 'Array.reverse',
	shift: 'Array.head and Array.drop',
	slice: 'Array.take, Array.drop or String.slice',
	sort: 'Array.sort(items, Order.mapInput(...))',
	splice: 'Array.remove or Array.insertAt',
	// oxlint-disable-next-line unicorn/no-thenable -- a lookup key naming Promise#then, never awaited.
	then: 'Effect.tryPromise and Effect.map',
	toSpliced: 'Array.remove or Array.insertAt',
	unshift: 'Array.prepend',
	values: 'Record.values or HashMap.values',
	with: 'Array.replace'
}

// Inner None means the flags are unknown.
function freshRegExpFlags(input: {context: Context; node: ESTree.Expression}) {
	if (input.node.type === 'Literal' && Predicate.hasProperty(input.node, 'regex')) {
		return Option.some(pipe(input.context.sourceCode.getText(input.node), String.split('/'), Array.last))
	}
	if (
		(input.node.type !== 'NewExpression' && input.node.type !== 'CallExpression') ||
		input.node.callee.type !== 'Identifier' ||
		input.node.callee.name !== 'RegExp'
	) {
		return Option.none()
	}
	const flags = input.node.arguments[1]
	if (flags === undefined) return Option.some(Option.some(''))
	if (flags.type !== 'Literal' || !Predicate.isString(flags.value)) return Option.some(Option.none<string>())
	return Option.some(Option.some(flags.value))
}

// The identifier a receiver chain starts from, through calls: `z` in `z.string().trim`.
function chainRoot(node: ESTree.Expression): ESTree.Expression {
	if (node.type === 'MemberExpression') return chainRoot(node.object)
	if (node.type === 'CallExpression' && node.callee.type !== 'Super') return chainRoot(node.callee)
	if (node.type === 'ParenthesizedExpression') return chainRoot(node.expression)
	return node
}

// `yield* Groups` or `yield* FileSystem.FileSystem` binds an Effect service, whose methods are its own; a service is a class, so its name is capitalized.
function isYieldedService(node?: ESTree.Node | null) {
	if (node?.type !== 'YieldExpression' || !node.delegate || Predicate.isNullish(node.argument)) return false
	if (node.argument.type === 'Identifier') return matches(/^[A-Z]/u)(node.argument.name)
	return (
		node.argument.type === 'MemberExpression' &&
		Option.exists(memberName(node.argument), name => matches(/^[A-Z]/u)(name))
	)
}

// Effect's functions return native arrays, strings and promises, so only another package's call chain owns its methods.
const effectPackage = matches(/^(?:effect(?:\/|$)|@effect\/)/u)
const localPath = matches(/^[.#~/]|^@\//u)

// A receiver that is not a native value: a package's own API, a global class's static method, or an Effect service.
function ownsMethod(input: {context: Context; receiver: ESTree.Expression}) {
	const root = chainRoot(input.receiver)
	const throughCall = root !== memberRoot(input.receiver)
	if (isYieldedService(root)) return true
	if (root.type !== 'Identifier') return false
	if (root.name === 'path') return !throughCall
	return pipe(
		variableFor(input.context, root),
		// A global such as Buffer can appear as a variable without definitions.
		Option.filter(variable => Array.isReadonlyArrayNonEmpty(variable.defs)),
		Option.match({
			// An unbound capitalized name is a global class such as Buffer; Object, Promise and RegExp stay native.
			onNone: () =>
				!throughCall && matches(/^[A-Z]/u)(root.name) && !Array.contains(['Object', 'Promise', 'RegExp'], root.name),
			onSome: variable =>
				Array.some(variable.defs, definition => {
					if (definition.node.type === 'VariableDeclarator') {
						return !throughCall && isYieldedService(definition.node.init)
					}
					if (definition.type !== 'ImportBinding' || definition.parent?.type !== 'ImportDeclaration') return false
					return (
						!localPath(definition.parent.source.value) &&
						!(throughCall && effectPackage(definition.parent.source.value))
					)
				})
		})
	)
}

export const noNativeMethodCall = defineRule({
	create: context => ({
		CallExpression: node => {
			if (node.callee.type !== 'MemberExpression' || ownsMethod({context, receiver: node.callee.object})) return
			const regExpFlags = freshRegExpFlags({context, node: node.callee.object})
			if (
				Option.isSome(regExpFlags) &&
				Option.exists(
					memberName(node.callee),
					// String.match returns every match of a global pattern, unlike exec, so only a non-global exec maps to it.
					name =>
						name === 'test' ||
						(name === 'exec' && Option.exists(Option.flatten(regExpFlags), flags => !pipe(flags, String.includes('g'))))
				)
			) {
				context.report({
					message: 'Match with String.match, which returns an Option, instead of a native RegExp method.',
					node: node.callee
				})
				return
			}
			pipe(
				memberName(node.callee),
				// `Object.keys(record)` belongs to prefer-effect-record; only an argument-free `.keys()` is a native iterator.
				Option.filter(
					name => !Array.contains(['entries', 'keys', 'values'], name) || Array.isArrayEmpty(node.arguments)
				),
				Option.flatMap(name =>
					pipe(
						Record.get(REPLACEMENTS, name),
						Option.map(replacement => ({name, replacement}))
					)
				),
				Option.map(method =>
					context.report({
						message: `Use ${method.replacement} instead of the native .${method.name}(); a third-party object's own method stays, with an inline disable naming it.`,
						node: node.callee
					})
				)
			)
		}
	}),
	meta: {type: 'problem'}
})
