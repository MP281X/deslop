import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {isImportBinding, memberName} from './shared.ts'

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
			const name = memberName(node.callee)
			if (Option.isSome(name) && Array.contains(nativeMethods, name.value)) {
				context.report({
					message: `Replace .${name.value}() with its function from the Effect Array, String, or Effect module.`,
					node: node.callee
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
