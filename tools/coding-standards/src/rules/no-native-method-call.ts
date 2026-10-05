import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {isImportBinding, memberName} from '#rules/shared.ts'

const nativeMethods = [
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

// The flags of a native regular expression literal or global RegExp construction; inner None means unknown flags.
// The flags of a regular expression created right here: a literal, or RegExp with a literal pattern. Inner None means
// unknown flags.
function freshRegExpFlags(input: {context: Context; node: ESTree.Expression}): Option.Option<Option.Option<string>> {
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
	return Option.some(
		flags.type === 'Literal' && Predicate.isString(flags.value) ? Option.some(flags.value) : Option.none()
	)
}

export const noNativeMethodCall = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				(node.callee.object.type === 'Identifier' &&
					(node.callee.object.name === 'path' ||
						isImportBinding({context, node: node.callee.object, source: /^(?:effect(?:\/|$)|@effect\/)/u})))
			) {
				return
			}
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
				Option.filter(name => Array.contains(nativeMethods, name)),
				Option.filter(
					name =>
						!Array.contains(['entries', 'keys', 'values'], name) ||
						Array.isArrayEmpty(node.arguments) ||
						(receiver.type === 'Identifier' && receiver.name === 'Object')
				),
				Option.map(name => {
					context.report({
						message: `Replace .${name}() on a native array, string, record, or Promise with its Effect Array, String, Record, or Effect function; a third-party API's own method stays, with an inline disable and its reason.`,
						node: node.callee
					})
				})
			)
		}
	}),
	meta: {type: 'problem'}
})
