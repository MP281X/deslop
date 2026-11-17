import {Array, Option, Predicate, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isFunction, isImportBinding, memberName, variableFromScope, variableOf} from '#lib/ast.ts'

const BUILDERS: Record.ReadonlyRecord<string, string[]> = {
	MutableHashMap: ['set'],
	MutableHashSet: ['add'],
	MutableList: ['append', 'prepend']
}

function target(context: Context, node: ESTree.Node) {
	if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.computed) {
		return Option.some(node.left.object)
	}
	if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return Option.none<ESTree.Node>()
	if (Option.exists(memberName(node.callee), name => Array.contains(['push', 'unshift', 'splice'], name))) {
		return Option.some(node.callee.object)
	}
	if (
		Array.some(
			Record.toEntries(BUILDERS),
			entry =>
				node.callee.type === 'MemberExpression' &&
				importedMember({context, importedName: entry[0], node: node.callee}) &&
				Option.exists(memberName(node.callee), name => Array.contains(entry[1], name))
		)
	) {
		return Array.head(node.arguments)
	}
	return Option.none()
}

function loop(context: Context, node: ESTree.Node): Option.Option<ESTree.Node> {
	if (Predicate.isNullish(node.parent)) return Option.none()
	if (
		Array.contains(
			['ForOfStatement', 'ForInStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement'],
			node.parent.type
		)
	) {
		return Option.some(node.parent)
	}
	if (
		node.parent.type === 'CallExpression' &&
		importedMember({context, importedName: 'Array', node: node.parent.callee, propertyName: 'forEach'})
	) {
		return Option.some(node.parent)
	}
	return loop(context, node.parent)
}

export function collectingLoop(context: Context, node: ESTree.Node) {
	return pipe(
		target(context, node),
		Option.filter((collector): collector is ESTree.IdentifierReference => collector.type === 'Identifier'),
		Option.flatMap(collector =>
			variableFromScope({name: collector.name, scope: context.sourceCode.getScope(collector)})
		),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.filter(
			definition =>
				definition.type === 'Parameter' ||
				(definition.type === 'Variable' &&
					definition.node.type === 'VariableDeclarator' &&
					definition.node.init !== null &&
					(definition.node.init.type === 'ArrayExpression' ||
						definition.node.init.type === 'ObjectExpression' ||
						(definition.node.init.type === 'CallExpression' &&
							definition.node.init.callee.type === 'MemberExpression' &&
							Option.exists(memberName(definition.node.init.callee), name => Array.contains(['empty', 'make'], name)))))
		),
		Option.flatMap(() => loop(context, node)),
		Option.isSome
	)
}

// `Effect.<name>` through `import {Effect} from 'effect'` or a namespace import of 'effect/Effect'.
function effectMember(context: Context, node: ESTree.Node, names: string[]) {
	return (
		node.type === 'MemberExpression' &&
		node.object.type === 'Identifier' &&
		Option.exists(memberName(node), name => Array.contains(names, name)) &&
		(isImportBinding({context, importedName: 'Effect', node: node.object, source: 'effect'}) ||
			isImportBinding({context, node: node.object, source: 'effect/Effect'}))
	)
}

// The generator of Effect.gen, Effect.fn or Effect.fnUntraced, called directly or curried, stopping at the nearest function.
function effectGenerator(context: Context, node: ESTree.Node): boolean {
	if (node.type === 'FunctionExpression' && node.generator && node.parent.type === 'CallExpression') {
		return (
			effectMember(context, node.parent.callee, ['gen', 'fn', 'fnUntraced']) ||
			(node.parent.callee.type === 'CallExpression' &&
				effectMember(context, node.parent.callee.callee, ['fn', 'fnUntraced']))
		)
	}
	if (isFunction(node) || node.parent === null) return false
	return effectGenerator(context, node.parent)
}

// The for-of whose body is this statement, alone or as its block's one statement.
function soleBodyOf(statement: ESTree.ExpressionStatement) {
	if (statement.parent.type === 'BlockStatement' && statement.parent.body.length === 1) return statement.parent.parent
	return statement.parent
}

// The module a yielded value is built from: `Option` in `Option.some(n)` or `Option.none()`.
function builtFrom(node: ESTree.Expression): ESTree.Expression {
	if (node.type === 'CallExpression' && node.callee.type !== 'Super') return builtFrom(node.callee)
	if (node.type === 'MemberExpression') return builtFrom(node.object)
	return node
}

// Walking back from the loop over declarations only, the `const name = []` the loop collects into and the declarations passed on the way.
function accumulatorBefore(forOf: ESTree.ForOfStatement, name: string) {
	if (forOf.parent.type !== 'BlockStatement') return Option.none()
	const before = Array.reverse(Array.takeWhile(forOf.parent.body, statement => statement !== forOf))
	const between = Array.takeWhile(
		before,
		statement =>
			statement.type === 'VariableDeclaration' &&
			!Array.some(
				statement.declarations,
				declarator => declarator.id.type === 'Identifier' && declarator.id.name === name
			)
	)
	return pipe(
		Array.get(before, between.length),
		Option.filter(
			(statement): statement is ESTree.VariableDeclaration =>
				statement.type === 'VariableDeclaration' &&
				statement.kind === 'const' &&
				statement.declarations.length === 1 &&
				statement.declarations[0]?.init?.type === 'ArrayExpression' &&
				Array.isArrayEmpty(statement.declarations[0].init.elements)
		),
		Option.map(declaration => ({between, declaration}))
	)
}

// effecttsgo/for-loop-push-to-for-each owns, with its Effect.forEach suggestion, a `for (const x of xs)` in an Effect generator whose one statement is `acc.push(yield* effect)`, collecting into a `const acc = []` that only other declarations separate from the loop and that neither they, the iterable, the binding nor the effect read.
function effectForEachLoop(context: Context, node: ESTree.CallExpression) {
	if (
		node.optional ||
		node.callee.type !== 'MemberExpression' ||
		node.callee.optional ||
		node.callee.object.type !== 'Identifier' ||
		!Option.contains(memberName(node.callee), 'push') ||
		node.arguments.length !== 1 ||
		node.arguments[0]?.type !== 'YieldExpression' ||
		!node.arguments[0].delegate ||
		node.arguments[0].argument === null ||
		node.parent.type !== 'ExpressionStatement'
	) {
		return false
	}
	const yielded = node.arguments[0].argument
	// Effect's rule needs an Effect type; an Option or Result built in place is yieldable but stays ours.
	const built = builtFrom(yielded)
	if (
		built.type === 'Identifier' &&
		Array.some(['Option', 'Result'], name =>
			isImportBinding({context, importedName: name, node: built, source: 'effect'})
		)
	) {
		return false
	}
	const forOf = soleBodyOf(node.parent)
	if (forOf.type !== 'ForOfStatement' || forOf.await || forOf.left.type !== 'VariableDeclaration') return false
	if (forOf.left.kind !== 'const' || forOf.left.declarations.length !== 1 || !effectGenerator(context, forOf)) {
		return false
	}
	const receiver = node.callee.object
	return Option.exists(accumulatorBefore(forOf, receiver.name), found =>
		Option.exists(
			variableOf(context, receiver),
			variable =>
				Array.some(variable.defs, definition => definition.node === found.declaration.declarations[0]) &&
				!Array.some(variable.references, reference =>
					Array.some(
						[forOf.right, forOf.left, yielded, ...found.between],
						inside =>
							reference.identifier.range[0] >= inside.range[0] && reference.identifier.range[1] <= inside.range[1]
					)
				)
		)
	)
}

export const noCollectingLoop = defineRule({
	create: context => {
		function check(node: ESTree.Node) {
			if (!collectingLoop(context, node)) return
			if (node.type === 'CallExpression' && effectForEachLoop(context, node)) return
			context.report({
				message:
					'Build the collection with Array.map, filterMap, flatMap, partition or Record.fromEntries; use Array.mapAccum when an item depends on earlier items, and Effect.forEach for effectful work.',
				node
			})
		}
		return {AssignmentExpression: check, CallExpression: check}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Array} from 'effect'
export function noteIds(notes: readonly {id: string}[]) { return Array.map(notes, note => note.id) }`
					}
				]
			}
		},
		type: 'problem'
	}
})
