import {Array, Function, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {
	importedMember,
	matches,
	memberName,
	returnedExpression,
	rootName,
	singleUseThunk,
	variableFor,
	variableFromScope
} from '#rules/shared.ts'

function parameterName(parameter: ESTree.ParamPattern) {
	if (parameter.type === 'Identifier') return Option.some(parameter.name)
	if (parameter.type === 'RestElement' && parameter.argument.type === 'Identifier') {
		return Option.some(parameter.argument.name)
	}
	return Option.none()
}

function forwarded(input: {args: ESTree.CallExpression['arguments']; names: string[]}) {
	return (
		input.args.length === input.names.length &&
		Array.every(input.args, (argument, index) => {
			const name = input.names[index]
			if (argument.type === 'SpreadElement') {
				return argument.argument.type === 'Identifier' && argument.argument.name === name
			}
			return argument.type === 'Identifier' && argument.name === name
		})
	)
}

function callGroups(node: ESTree.Node): {callee: ESTree.Node; groups: ESTree.CallExpression['arguments'][]} {
	if (node.type !== 'CallExpression') return {callee: node, groups: []}
	const inner = callGroups(node.callee)
	return {callee: inner.callee, groups: Array.append(inner.groups, node.arguments)}
}

// Effect modules export plain functions, so `Effect.succeed` runs without `this`; a method such as `Schema.String.annotate` needs its receiver.
function detachable(input: {context: Context; node: ESTree.Node}) {
	if (input.node.type === 'Identifier') return true
	if (input.node.type !== 'MemberExpression' || input.node.object.type !== 'Identifier') return false
	return pipe(
		rootName(input.node),
		Option.flatMap(name => variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)})),
		Option.exists(variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.type === 'ImportBinding' &&
					definition.parent?.type === 'ImportDeclaration' &&
					// `effect` exports its modules, and `effect/Schema` exports objects such as `String` too.
					(definition.parent.source.value === 'effect' ||
						(definition.node.type === 'ImportNamespaceSpecifier' &&
							matches(/^effect\//u)(definition.parent.source.value)))
			)
		)
	)
}

// `value => Schema.is(File)(value)` and `value => Effect.succeed(value)` only pass their parameters, in order, to a fixed function.
function forwardedChain(input: {context: Context; names: string[]; returned: ESTree.Node}) {
	const chain = callGroups(input.returned)
	function fixed(node: ESTree.Node) {
		return node.type === 'Literal' || Option.exists(rootName(node), root => !Array.contains(input.names, root))
	}
	return Array.matchRight(chain.groups, {
		onEmpty: Function.constFalse,
		onNonEmpty: (earlier, last) =>
			fixed(chain.callee) &&
			Array.every(Array.flatten(earlier), fixed) &&
			forwarded({args: last, names: input.names}) &&
			(Array.isArrayNonEmpty(earlier) || detachable({context: input.context, node: chain.callee}))
	})
}

function exactForwardingFunction(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	const names = pipe(input.node.params, Array.map(parameterName), Array.getSomes)
	const returned = returnedExpression(input.node)
	// An async function also turns a throw into a rejected Promise, and a generator returns an iterator.
	if (
		input.node.async ||
		input.node.generator ||
		Array.isArrayEmpty(names) ||
		names.length !== input.node.params.length ||
		Predicate.isNullish(returned)
	) {
		return false
	}
	if (returned.type === 'Identifier') return names.length === 1 && returned.name === names[0]
	return (
		(returned.type === 'NewExpression' &&
			returned.callee.type === 'Identifier' &&
			forwarded({args: returned.arguments, names})) ||
		forwardedChain({context: input.context, names, returned})
	)
}

function isIdentity(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	const [parameter] = node.params
	const returned = returnedExpression(node)
	return (
		node.params.length === 1 &&
		parameter?.type === 'Identifier' &&
		returned?.type === 'Identifier' &&
		returned.name === parameter.name
	)
}

function indirectionMessage(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (isIdentity(input.node)) return 'Pass identity from effect instead of this function.'
	const returned = returnedExpression(input.node)
	if (exactForwardingFunction(input) && returned?.type === 'CallExpression') {
		return `Use ${input.context.sourceCode.getText(returned.callee)} directly; this function only passes its parameters on.`
	}
	return 'Inline this function at its only use site.'
}

function isExport(node: ESTree.Node | null) {
	return node?.type === 'ExportNamedDeclaration' || node?.type === 'ExportDefaultDeclaration'
}

function unexportedBindingName(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.type === 'FunctionDeclaration' && node.id !== null && !isExport(node.parent)) {
		return Option.some(node.id.name)
	}
	if (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.id.type === 'Identifier' &&
		node.parent.id.typeAnnotation === null &&
		!isExport(node.parent.parent.parent)
	) {
		return Option.some(node.parent.id.name)
	}
	return Option.none()
}

function singleCallerWrapper(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	const names = pipe(input.node.params, Array.map(parameterName), Array.getSomes)
	if (
		input.node.async ||
		input.node.generator ||
		input.node.returnType?.typeAnnotation.type === 'TSTypePredicate' ||
		Array.isArrayEmpty(names) ||
		names.length !== input.node.params.length ||
		returnedExpression(input.node)?.type !== 'CallExpression'
	) {
		return false
	}
	return pipe(
		unexportedBindingName(input.node),
		Option.flatMap(name => variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)})),
		Option.exists(variable => {
			const reads = Array.filter(variable.references, reference => reference.isRead())
			return (
				reads.length === 1 &&
				Array.every(
					reads,
					reference =>
						reference.identifier.parent.type === 'CallExpression' &&
						reference.identifier.parent.callee === reference.identifier
				)
			)
		})
	)
}

function redundantConstAlias(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null ||
		input.node.init?.type !== 'Identifier' ||
		!pipe(
			variableFor(input.context, input.node.init),
			Option.exists(variable => {
				if (Array.some(variable.references, reference => reference.isWrite() && !reference.init)) return false
				return Array.some(variable.defs, definition => {
					if (definition.type === 'ImportBinding' || definition.type === 'Parameter') return true
					return (
						definition.node.type === 'VariableDeclarator' &&
						definition.node.parent.type === 'VariableDeclaration' &&
						definition.node.parent.kind === 'const'
					)
				})
			})
		)
	) {
		return false
	}
	return pipe(
		variableFromScope({name: input.node.id.name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.exists(alias => Array.filter(alias.references, reference => reference.isRead()).length === 1)
	)
}

function exportedAlias(input: {context: Context; node: ESTree.VariableDeclarator}) {
	return (
		input.node.parent.type === 'VariableDeclaration' &&
		input.node.parent.kind === 'const' &&
		input.node.parent.parent.type === 'ExportNamedDeclaration' &&
		input.node.id.type === 'Identifier' &&
		input.node.init?.type === 'Identifier' &&
		pipe(
			variableFor(input.context, input.node.init),
			Option.exists(variable =>
				Array.some(
					variable.defs,
					definition =>
						definition.type === 'ImportBinding' ||
						definition.type === 'FunctionName' ||
						definition.type === 'ClassName' ||
						(definition.node.type === 'VariableDeclarator' &&
							definition.node.parent.type === 'VariableDeclaration' &&
							definition.node.parent.kind === 'const')
				)
			)
		)
	)
}

function singleUseLiteral(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		isExport(input.node.parent.parent) ||
		// module-constant owns module-level literals.
		input.node.parent.parent.type === 'Program' ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null ||
		!(
			(input.node.init?.type === 'Literal' && !Predicate.hasProperty(input.node.init, 'regex')) ||
			(input.node.init?.type === 'TemplateLiteral' && Array.isArrayEmpty(input.node.init.expressions))
		)
	) {
		return false
	}
	return pipe(
		variableFromScope({name: input.node.id.name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.map(variable => Array.filter(variable.references, reference => reference.isRead())),
		Option.exists(reads => reads.length === 1 && reads[0]?.identifier.parent.type !== 'ExportSpecifier')
	)
}

function singleUseLayerPart(input: {context: Context; node: ESTree.VariableDeclarator}) {
	const init = input.node.init
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		isExport(input.node.parent.parent) ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null ||
		init === null
	) {
		return false
	}
	return pipe(
		variableFromScope({name: input.node.id.name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.map(variable => Array.filter(variable.references, reference => reference.isRead())),
		Option.exists(reads => {
			const consumer = reads[0]?.identifier.parent
			if (reads.length !== 1 || consumer?.type !== 'CallExpression') return false
			if (init.type === 'MemberExpression') {
				return (
					Option.contains(memberName(init), 'layer') &&
					(importedMember({context: input.context, importedName: 'Layer', node: consumer.callee}) ||
						importedMember({
							context: input.context,
							importedName: 'Effect',
							node: consumer.callee,
							propertyName: 'provide'
						}))
				)
			}
			return (
				init.type === 'CallExpression' &&
				importedMember({context: input.context, importedName: 'Effect', node: init.callee, propertyName: 'gen'}) &&
				consumer.arguments[1] === reads[0]?.identifier &&
				importedMember({context: input.context, importedName: 'Layer', node: consumer.callee, propertyName: 'effect'})
			)
		})
	)
}

export const noTrivialIndirection = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => {
			if (
				(node.parent.type === 'VariableDeclarator' || node.parent.type === 'Property') &&
				(exactForwardingFunction({context, node}) ||
					singleUseThunk({context, node}) ||
					singleCallerWrapper({context, node}))
			) {
				context.report({message: indirectionMessage({context, node}), node})
			}
		},
		FunctionDeclaration: node => {
			if (
				exactForwardingFunction({context, node}) ||
				singleUseThunk({context, node}) ||
				singleCallerWrapper({context, node})
			) {
				context.report({message: indirectionMessage({context, node}), node})
			}
		},
		FunctionExpression: node => {
			if (
				(node.parent.type === 'VariableDeclarator' ||
					node.parent.type === 'Property' ||
					(node.parent.type === 'MethodDefinition' && node.parent.override !== true)) &&
				(exactForwardingFunction({context, node}) ||
					singleUseThunk({context, node}) ||
					singleCallerWrapper({context, node}))
			) {
				context.report({message: indirectionMessage({context, node}), node})
			}
		},
		VariableDeclarator: node => {
			if (exportedAlias({context, node})) {
				context.report({message: 'Export the value under one name; this second name is an alias.', node})
			}
			if (redundantConstAlias({context, node})) {
				context.report({message: 'Use the immutable source binding directly.', node})
			}
			if (singleUseLiteral({context, node})) {
				context.report({message: 'Inline this literal at its only use site.', node})
			}
			if (singleUseLayerPart({context, node})) {
				context.report({message: 'Write this layer part where its only layer uses it.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
