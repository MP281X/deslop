import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {isTestFile, matches, memberName} from '#lib/ast.ts'

const MESSAGE =
	'Test our logic through plain values or service methods with Effect layer stand-ins; prove screens in the browser and protocol wiring through traces.'

function outside(source: string, names: string[]) {
	return (
		matches(
			/^(?:react(?:-dom|-test-renderer)?(?:\/|$)|@testing-library\/|jsdom$|happy-dom$|@vitest\/|vitest(?:\/|$)|vite-plus\/test$|node:(?:fs|http|https|net|child_process|sqlite)|@modelcontextprotocol\/|@effect\/rpc|effect\/(?:http|rpc|ai\/Mcp|Tracer|unstable\/http|unstable\/rpc))/u
		)(source) ||
		matches(/(?:^|\/)(?:handlers|contracts|page|registry)\.[cm]?[jt]sx?$/u)(source) ||
		matches(/\.tsx$/u)(source) ||
		(source === '@effect/vitest' && Array.some(names, name => Array.contains(['expect', 'vi', 'vitest'], name))) ||
		((source === 'effect' || source === 'effect/reactivity') &&
			Array.some(names, name => Array.contains(['Atom', 'AtomRegistry', 'Tracer'], name))) ||
		source === 'effect/reactivity/Atom' ||
		source === 'effect/reactivity/AtomRegistry'
	)
}

export const testBoundaries = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				!isTestFile(context) ||
				Array.contains(context.options, 'source-fixtures') ||
				Array.contains(context.options, 'model-migrations')
			) {
				return
			}
			if (
				(node.callee.type === 'Identifier' && node.callee.name === 'fetch') ||
				(node.callee.type === 'MemberExpression' &&
					Option.exists(memberName(node.callee), name => Array.contains(['readFileString', 'readFile', 'glob'], name)))
			) {
				context.report({message: MESSAGE, node})
			}
		},
		ImportDeclaration: node => {
			if (!isTestFile(context) || node.importKind === 'type') return
			const names = Array.flatMap(node.specifiers, specifier => {
				if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') return []
				return [specifier.imported.name]
			})
			const sql = matches(/^(?:effect\/sql(?:\/|$)|@effect\/sql(?:\/|$))/u)(node.source.value)
			if (
				outside(node.source.value, names) ||
				(node.source.value === 'effect/process' && !Array.contains(context.options, 'source-fixtures')) ||
				(sql && !Array.contains(context.options, 'model-migrations'))
			) {
				context.report({message: MESSAGE, node})
			}
		},
		ImportExpression: node => {
			if (!isTestFile(context)) return
			context.report({
				message: 'Use a static import of the logic under test and provide its outside services with Effect layers.',
				node
			})
		},
		JSXElement: node => {
			if (isTestFile(context)) context.report({message: MESSAGE, node})
		},
		NewExpression: node => {
			if (
				isTestFile(context) &&
				node.callee.type === 'Identifier' &&
				Array.contains(['Request', 'Response', 'WebSocket', 'XMLHttpRequest'], node.callee.name)
			) {
				context.report({message: MESSAGE, node})
			}
		},
		// Vitest reads the pragma anywhere in a test file's text, comment or not.
		Program: () => {
			if (!isTestFile(context)) return
			for (const pragma of String.matchAll(/@(?:vitest|jest)-environment\s+[\w-]+/gu)(context.sourceCode.text)) {
				context.report({loc: context.sourceCode.getLocFromIndex(pragma.index ?? 0), message: MESSAGE})
			}
		},
		Property: node => {
			if (
				!node.computed &&
				node.key.type === 'Identifier' &&
				node.key.name === 'environment' &&
				node.value.type === 'Literal' &&
				Predicate.isString(node.value.value) &&
				Array.contains(['happy-dom', 'jsdom'], node.value.value)
			) {
				context.report({message: MESSAGE, node})
			}
		}
	}),
	meta: {schema: [{enum: ['source-fixtures', 'model-migrations']}], type: 'problem'}
})
