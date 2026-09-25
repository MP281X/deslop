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
				node.callee.type === 'MemberExpression' &&
				!(
					node.callee.object.type === 'Identifier' &&
					(node.callee.object.name === 'path' ||
						isImportBinding({
							context,
							importedName: node.callee.object.name,
							node: node.callee.object,
							source: /^(?:effect(?:\/|$)|@effect\/)/u
						}))
				) &&
				Option.exists(memberName(node.callee), name => Array.contains(nativeMethods, name))
			) {
				context.report({message: 'Use an Effect module function.', node: node.callee})
			}
		}
	}),
	meta: {type: 'problem'}
})
