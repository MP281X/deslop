import {Array, Equivalence, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Reference, Variable} from 'vite-plus/lint/plugins'

import {
	bindingName,
	effectImport,
	importedMember,
	isImportBinding,
	isReactUseState,
	matches,
	variableFromScope
} from '#lib/ast.ts'

// Not boolean: without its annotation, `return part.type === 'text'` is inferred as a type predicate that narrows callers.
const KEYWORD_TYPES = ['TSBigIntKeyword', 'TSNumberKeyword', 'TSStringKeyword']

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function

function elementType(node: ESTree.TSType) {
	if (node.type === 'TSArrayType') return Option.some(node.elementType)
	if (node.type === 'TSTypeReference' && node.typeName.type === 'Identifier' && node.typeName.name === 'Array')
		return Option.fromNullishOr(node.typeArguments?.params[0])
	return Option.none()
}

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

export const noRedundantAnnotation = defineRule({
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
				// Inference widens a returned literal back to these keyword types; any other annotation can be the contextual type that returned objects and callbacks need.
				fix: fixer => {
					if (!Array.contains(KEYWORD_TYPES, returnType.typeAnnotation.type)) return []
					return fixer.remove(returnType)
				},
				message: 'Drop the return type and let inference supply it; check a returned object with satisfies.',
				node: returnType
			})
		}
		return {
			ArrowFunctionExpression: check,
			CallExpression: node => {
				const argument = node.arguments[0]
				const types = node.typeArguments
				const type = types?.params[0]
				if (node.arguments.length !== 1 || types?.params.length !== 1 || argument?.type !== 'Literal' || !type) return
				if (
					node.callee.type === 'Identifier' &&
					isImportBinding({context, importedName: 'useRef', node: node.callee, source: 'react'}) &&
					argument.value === null &&
					type.type === 'TSUnionType'
				) {
					pipe(
						type.types,
						Array.findFirst(member => member.type === 'TSNullKeyword'),
						Option.match({
							onNone: () => undefined,
							onSome: member =>
								context.report({
									fix: fixer => {
										const before = context.sourceCode.getTokenBefore(member)
										const after = context.sourceCode.getTokenAfter(member)
										if (before?.value === '|') return fixer.removeRange([before.range[0], member.range[1]])
										if (after?.value === '|') return fixer.removeRange([member.range[0], after.range[1]])
										return []
									},
									message: 'Remove null from the useRef type; its initializer already supplies it.',
									node: member
								})
						})
					)
					return
				}
				if (
					!(
						isReactUseState({context, node}) ||
						Array.some(['MutableRef', 'Ref', 'SubscriptionRef'], importedName =>
							importedMember({context, importedName, node: node.callee, propertyName: 'make'})
						)
					)
				)
					return
				if (
					(Predicate.isString(argument.value) && type.type === 'TSStringKeyword') ||
					(Predicate.isNumber(argument.value) && type.type === 'TSNumberKeyword') ||
					(Predicate.isBoolean(argument.value) && type.type === 'TSBooleanKeyword')
				) {
					context.report({
						fix: fixer => fixer.remove(types),
						message: 'Drop the state type; its initializer supplies it.',
						node: type
					})
				}
			},
			FunctionDeclaration: check,
			FunctionExpression: check,
			VariableDeclarator: node => {
				const annotation = node.id.typeAnnotation
				const init = node.init
				if (init?.type !== 'ArrayExpression' || Array.isArrayNonEmpty(init.elements) || !annotation) return
				Option.match(elementType(annotation.typeAnnotation), {
					onNone: () => undefined,
					onSome: element =>
						context.report({
							fix: fixer =>
								pipe(
									effectImport({context, fixer, name: 'Array', node}),
									Option.map(imports => [
										...imports,
										fixer.remove(annotation),
										fixer.replaceText(init, `Array.empty<${context.sourceCode.getText(element)}>()`)
									]),
									Option.getOrElse(() => [])
								),
							message: 'Write Array.empty<T>(); its initializer supplies the collection type.',
							node: annotation
						})
				})
			}
		}
	},
	meta: {fixable: 'code', type: 'problem'}
})
