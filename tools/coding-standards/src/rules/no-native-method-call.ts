import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {matches, memberName, variableFor} from '#rules/shared.ts'

const NATIVE_METHODS = [
	'at',
	'catch',
	'charAt',
	'charCodeAt',
	'codePointAt',
	'concat',
	'endsWith',
	'entries',
	'every',
	'fill',
	'filter',
	'finally',
	'find',
	'findIndex',
	'findLast',
	'findLastIndex',
	'flat',
	'flatMap',
	'forEach',
	'includes',
	'indexOf',
	'join',
	'keys',
	'lastIndexOf',
	'localeCompare',
	'map',
	'match',
	'matchAll',
	'normalize',
	'padEnd',
	'padStart',
	'pop',
	'push',
	'reduce',
	'reduceRight',
	'repeat',
	'replace',
	'replaceAll',
	'reverse',
	'shift',
	'slice',
	'some',
	'sort',
	'splice',
	'split',
	'startsWith',
	'substring',
	'then',
	'toLocaleLowerCase',
	'toLocaleUpperCase',
	'toLowerCase',
	'toReversed',
	'toSorted',
	'toSpliced',
	'toUpperCase',
	'trim',
	'trimEnd',
	'trimStart',
	'unshift',
	'values',
	'with'
]

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

// The object a property chain starts from: `path` in `path.posix`.
function memberRoot(node: ESTree.Expression): ESTree.Expression {
	if (node.type === 'MemberExpression') return memberRoot(node.object)
	return node
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
			const receiver = node.callee.object
			const regExpFlags = freshRegExpFlags({context, node: receiver})
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
				Option.filter(name => Array.contains(NATIVE_METHODS, name)),
				Option.filter(
					name =>
						!Array.contains(['entries', 'keys', 'values'], name) ||
						Array.isArrayEmpty(node.arguments) ||
						(receiver.type === 'Identifier' && receiver.name === 'Object')
				),
				Option.map(name =>
					context.report({
						message: `Replace .${name}() on a native array, string, record, or Promise with its Effect Array, String, Record, or Effect function; a third-party API's own method stays, with an inline disable and its reason.`,
						node: node.callee
					})
				)
			)
		}
	}),
	meta: {type: 'problem'}
})
