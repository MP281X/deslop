import {Array, Equivalence, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Reference, Variable} from 'vite-plus/lint/plugins'

import {bindingName, importedMember, matches, variableFromScope} from '#rules/shared.ts'

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function

// A function wrapped in a call such as Effect.fn takes its name from the binding that holds the call.
function boundName(node: FunctionNode) {
	if (
		node.parent.type === 'CallExpression' &&
		node.parent.parent.type === 'VariableDeclarator' &&
		node.parent.parent.id.type === 'Identifier'
	) {
		return Option.some(node.parent.parent.id.name)
	}
	return bindingName(node)
}

// The function scopes that a declaration holds, such as the arrow function of `const read = () => …`.
function functionScopes(input: {context: Context; node: ESTree.Node}) {
	const scope = input.context.sourceCode.getScope(input.node)
	return Array.filter(
		[scope, ...scope.childScopes],
		child => child.block.range[0] >= input.node.range[0] && child.block.range[1] <= input.node.range[1]
	)
}

// `read.name` reads a property, and TypeScript infers it without the return type.
function propertyRead(reference: Reference) {
	return (
		reference.identifier.parent.type === 'MemberExpression' &&
		reference.identifier.parent.object === reference.identifier &&
		!(
			reference.identifier.parent.parent.type === 'CallExpression' &&
			reference.identifier.parent.parent.callee === reference.identifier.parent
		)
	)
}

// TypeScript cannot infer a function that reaches itself directly or through a chain of other functions.
function reaches(input: {context: Context; nodes: ESTree.Node[]; targets: Variable[]; visited: Variable[]}): boolean {
	const reached = pipe(
		input.nodes,
		Array.flatMap(node => functionScopes({context: input.context, node})),
		Array.flatMap(scope => scope.through),
		Array.filter(reference => !propertyRead(reference)),
		Array.flatMap(reference => Option.toArray(Option.fromNullishOr(reference.resolved))),
		Array.dedupeWith(Equivalence.strictEqual())
	)
	const known = Array.containsWith(Equivalence.strictEqual<Variable>())
	if (Array.some(reached, variable => known(input.targets, variable))) return true
	const next = Array.filter(reached, variable => !known(input.visited, variable))
	if (Array.isArrayEmpty(next)) return false
	return reaches({
		...input,
		nodes: pipe(
			next,
			Array.flatMap(variable => variable.defs),
			Array.filter(definition => definition.type === 'FunctionName' || definition.type === 'Variable'),
			Array.map(definition => definition.node)
		),
		visited: Array.appendAll(input.visited, next)
	})
}

// A method that calls `this.<name>` on its own name reaches itself.
function selfMethodCall(input: {context: Context; node: FunctionNode}) {
	if (input.node.parent.type !== 'MethodDefinition' || input.node.parent.key.type !== 'Identifier') return false
	return matches(new RegExp(`\\bthis\\.${String.replaceAll('$', '\\$')(input.node.parent.key.name)}\\(`, 'u'))(
		input.context.sourceCode.getText(input.node)
	)
}

function recursive(input: {context: Context; node: FunctionNode}) {
	const scope = input.context.sourceCode.getScope(input.node)
	// A named function expression also reaches itself through its own name.
	const targets = pipe(
		[boundName(input.node), Option.fromNullishOr(input.node.id?.name)],
		Array.getSomes,
		Array.flatMap(name => Option.toArray(variableFromScope({name, scope}))),
		Array.dedupeWith(Equivalence.strictEqual())
	)
	return (
		selfMethodCall(input) ||
		(Array.isArrayNonEmpty(targets) && reaches({context: input.context, nodes: [input.node], targets, visited: []}))
	)
}

export const noReturnType = defineRule({
	create: context => {
		function check(node: FunctionNode) {
			if (
				Predicate.isNullish(node.returnType) ||
				node.body === null ||
				node.returnType.typeAnnotation.type === 'TSTypePredicate' ||
				// A Schema.suspend thunk annotates the type of a recursive schema.
				(node.parent.type === 'CallExpression' &&
					importedMember({context, importedName: 'Schema', node: node.parent.callee, propertyName: 'suspend'})) ||
				recursive({context, node})
			) {
				return
			}
			const returnType = node.returnType
			context.report({
				fix: fixer => fixer.remove(returnType),
				message: 'Drop the return type and let inference supply it; check a returned object with satisfies.',
				node: returnType
			})
		}
		return {ArrowFunctionExpression: check, FunctionDeclaration: check, FunctionExpression: check}
	},
	meta: {fixable: 'code', type: 'problem'}
})
