import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {isTestFile, matches, memberName} from '#lib/ast.ts'

const MESSAGE =
	'Test our logic through plain values or service answers. Use assert from @effect/vitest and a Layer.mock stand-in for outside services; prove screens in the browser and protocol wiring through traces.'
const RUNNER = /^(?:@effect\/vitest|vitest|@vitest\/[^/]+|vite-plus\/test)(?:\/|$)/u

function outside(source: string, names: string[]) {
	return (
		matches(
			/^(?:react(?:-dom|-test-renderer)?(?:\/|$)|@testing-library\/|jsdom$|happy-dom$|@vitest\/|vitest(?:\/|$)|vite-plus\/test(?:\/|$)|(?:node:)?(?:fs|http|https|net|child_process|sqlite|dgram|dns|tls|http2|worker_threads|vm)(?:\/|$)|@modelcontextprotocol\/|@effect\/rpc|effect\/(?:rpc|ai\/Mcp|Tracer|unstable\/http|unstable\/rpc))/u
		)(source) ||
		matches(/(?:^|\/)(?:handlers|contracts|page|registry)\.[cm]?[jt]sx?$/u)(source) ||
		matches(/\.tsx$/u)(source) ||
		(source === 'effect/http' && Array.some(names, name => name !== 'Headers')) ||
		(matches(/^effect\/http\//u)(source) && source !== 'effect/http/Headers') ||
		(source === '@effect/vitest' && Array.some(names, name => Array.contains(['expect', 'vi', 'vitest'], name))) ||
		(source === '@effect/platform-node' && Array.some(names, matches(/^NodeHttp/u))) ||
		matches(/^@effect\/platform-node\/(?:NodeHttp|Undici)/u)(source) ||
		((source === 'effect' || source === 'effect/reactivity') &&
			Array.some(names, name => Array.contains(['Atom', 'AtomRegistry', 'Tracer'], name))) ||
		source === 'effect/reactivity/Atom' ||
		source === 'effect/reactivity/AtomRegistry'
	)
}

function globalNamed(node: ESTree.Expression | ESTree.Super, name: string) {
	if (node.type === 'Identifier') return node.name === name
	return (
		node.type === 'MemberExpression' &&
		node.object.type === 'Identifier' &&
		node.object.name === 'globalThis' &&
		Option.contains(memberName(node), name)
	)
}

function networkCall(node: ESTree.CallExpression) {
	return (
		globalNamed(node.callee, 'fetch') ||
		(node.callee.type === 'MemberExpression' && globalNamed(node.callee.object, 'Response'))
	)
}

export const testBoundaries = defineRule({
	create: context => ({
		CallExpression: node => {
			if (!isTestFile(context)) return
			if (networkCall(node)) {
				context.report({message: MESSAGE, node})
				return
			}
			if (node.callee.type !== 'MemberExpression') return
			if (
				Option.exists(memberName(node.callee), name => Array.contains(['readFileString', 'readFile'], name)) &&
				!Array.contains(context.options, 'read-source-text')
			) {
				context.report({message: MESSAGE, node})
			}
			if (Option.contains(memberName(node.callee), 'glob') && !Array.contains(context.options, 'inspect-database')) {
				context.report({message: MESSAGE, node})
			}
		},
		ImportDeclaration: node => {
			if (matches(/(?:^|\/)__mocks__(?:\/|$)/u)(node.source.value)) {
				context.report({message: MESSAGE, node})
				return
			}
			if (!isTestFile(context) && matches(RUNNER)(node.source.value)) {
				context.report({
					message:
						'Keep test runners in test files. Test helpers export plain logic or Effect layers; tests import assert from @effect/vitest.',
					node
				})
				return
			}
			if (!isTestFile(context) || node.importKind === 'type') return
			const names = Array.flatMap(node.specifiers, specifier => {
				if (specifier.type === 'ImportNamespaceSpecifier') return ['*']
				if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
					return [specifier.imported.name]
				}
				if (
					specifier.type === 'ImportSpecifier' &&
					specifier.imported.type === 'Literal' &&
					Predicate.isString(specifier.imported.value)
				) {
					return [specifier.imported.value]
				}
				return ['default']
			})
			if (
				outside(node.source.value, names) ||
				(node.source.value === '@effect/vitest' && Array.contains(names, '*')) ||
				(node.source.value === '@effect/platform-node' && Array.contains(names, '*')) ||
				(node.source.value === 'effect/process' && !Array.contains(context.options, 'execute-program')) ||
				(matches(/^(?:effect\/sql(?:\/|$)|@effect\/sql(?:\/|$))/u)(node.source.value) &&
					!Array.contains(context.options, 'inspect-database'))
			) {
				context.report({message: MESSAGE, node})
			}
		},
		ImportExpression: node => {
			if (
				isTestFile(context) ||
				(node.source.type === 'Literal' && Predicate.isString(node.source.value) && matches(RUNNER)(node.source.value))
			) {
				context.report({message: MESSAGE, node})
			}
		},
		JSXElement: node => {
			if (isTestFile(context)) context.report({message: MESSAGE, node})
		},
		NewExpression: node => {
			if (
				isTestFile(context) &&
				Array.some(['Request', 'Response', 'WebSocket', 'XMLHttpRequest'], name => globalNamed(node.callee, name))
			) {
				context.report({message: MESSAGE, node})
			}
		},
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
	meta: {
		schema: {
			items: {enum: ['read-source-text', 'inspect-database', 'execute-program']},
			type: 'array',
			uniqueItems: true
		},
		type: 'problem'
	}
})
