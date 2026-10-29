import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {
	childNodes,
	importedMember,
	memberName,
	resolveBinding,
	returnedExpression,
	variableFor,
	variableFromScope
} from '#rules/shared.ts'

// The fields of `X.make({...})` or `new X({...})`, the shapes a mapped error is built with.
function constructedFields(node?: ESTree.Expression | null) {
	if (node?.type !== 'CallExpression' && node?.type !== 'NewExpression') return Option.none()
	const constructs =
		node.type === 'NewExpression' ||
		(node.callee.type === 'MemberExpression' && Option.contains(memberName(node.callee), 'make'))
	const fields = node.arguments[0]
	if (!constructs || fields?.type !== 'ObjectExpression') return Option.none()
	return Option.some(fields)
}

function referencesFailure(context: Context, node: ESTree.Node, parameter: ESTree.BindingIdentifier): boolean {
	if (node.type === 'UnaryExpression' && node.operator === 'void') return false
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'message')) return false
	if (node.type === 'Identifier') {
		return Option.exists(
			variableFromScope({name: parameter.name, scope: context.sourceCode.getScope(parameter)}),
			failure => Array.some(failure.references, reference => reference.identifier === node && reference.isRead())
		)
	}
	return Array.some(childNodes(context, node), child => referencesFailure(context, child, parameter))
}

function causeKey(property: ESTree.ObjectPropertyKind) {
	return (
		property.type === 'Property' &&
		((property.key.type === 'Identifier' && property.key.name === 'cause') ||
			(property.key.type === 'Literal' && property.key.value === 'cause'))
	)
}

// An absent value has nothing to keep: the failure of Effect.fromOption or Effect.fromNullishOr.
function absence(context: Context, node: ESTree.Node): boolean {
	if (
		node.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Effect', node}) &&
		Option.exists(memberName(node), name => name === 'fromOption' || name === 'fromNullishOr')
	) {
		return true
	}
	return Array.some(childNodes(context, node), child => absence(context, child))
}

// Whether a mapper without parameters drops a failure: the Effect it maps shows in the code, data-first or as the previous pipe step, and is no absence.
function detailedFailure(context: Context, node: ESTree.CallExpression) {
	if (node.arguments.length >= 2) {
		return Option.exists(Option.fromNullishOr(node.arguments[0]), source => !absence(context, source))
	}
	if (node.parent.type !== 'CallExpression') return false
	const call = node.parent
	return pipe(
		Array.findFirstIndex(call.arguments, argument => argument === node),
		Option.flatMap(index => {
			if (index > 0) return Option.fromNullishOr(call.arguments[index - 1])
			if (call.callee.type === 'MemberExpression' && Option.contains(memberName(call.callee), 'pipe')) {
				return Option.some(call.callee.object)
			}
			return Option.none()
		}),
		Option.exists(source => !absence(context, source))
	)
}

function dropsCause(context: Context, argument: ESTree.Node, bare: boolean) {
	const node = resolveBinding(context, argument)
	if (
		node.type !== 'ArrowFunctionExpression' &&
		node.type !== 'FunctionExpression' &&
		node.type !== 'FunctionDeclaration'
	) {
		return false
	}
	// Leaving a detailed failure out of the parameters drops it as surely as leaving it out of the fields.
	if (Array.isArrayEmpty(node.params)) return bare && Option.isSome(constructedFields(returnedExpression(node)))
	const parameter = node.params[0]
	if (parameter?.type !== 'Identifier') return false
	return Option.exists(constructedFields(returnedExpression(node)), fields =>
		Array.every(
			fields.properties,
			property =>
				property.type === 'SpreadElement' ||
				!causeKey(property) ||
				!referencesFailure(context, property.value, parameter)
		)
	)
}

function keyName(property: ESTree.ObjectPropertyKind) {
	if (property.type !== 'Property') return Option.none()
	if (property.key.type === 'Identifier') return Option.some(property.key.name)
	if (property.key.type === 'Literal' && Predicate.isString(property.key.value)) return Option.some(property.key.value)
	return Option.none()
}

function causeField(parameter?: ESTree.ParamPattern) {
	if (parameter?.type === 'Identifier' && parameter.name !== 'cause') return `cause: ${parameter.name}`
	return 'cause'
}

// The new field in its sorted place among the constructed fields.
function insertField(input: {field: string; fields: ESTree.ObjectExpression; fixer: Fixer}) {
	return Option.match(
		Array.findFirst(input.fields.properties, property =>
			Option.exists(keyName(property), key => String.Order(key, 'cause') > 0)
		),
		{
			onNone: () =>
				Option.match(Array.last(input.fields.properties), {
					onNone: () => input.fixer.replaceText(input.fields, `{${input.field}}`),
					onSome: last => input.fixer.insertTextAfter(last, `, ${input.field}`)
				}),
			onSome: property => input.fixer.insertTextBefore(property, `${input.field}, `)
		}
	)
}

function constructedClass(node?: ESTree.Node | null) {
	if (node?.type === 'NewExpression' && node.callee.type === 'Identifier') return Option.some(node.callee)
	if (
		node?.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier'
	) {
		return Option.some(node.callee.object)
	}
	return Option.none()
}

function hasCauseField(context: Context, node: ESTree.Node): boolean {
	if (node.type === 'ObjectExpression' && Array.some(node.properties, causeKey)) return true
	return Array.some(childNodes(context, node), child => hasCauseField(context, child))
}

// The error is declared in this file with a `cause` field; an imported one, or one without the field, is left to a person.
function declaresCause(context: Context, node?: ESTree.Node | null) {
	return Option.exists(constructedClass(node), name =>
		Option.exists(variableFor(context, name), variable =>
			Array.some(
				variable.defs,
				definition =>
					(definition.node.type === 'ClassDeclaration' &&
						Predicate.isNotNullish(definition.node.superClass) &&
						hasCauseField(context, definition.node.superClass)) ||
					(definition.node.type === 'VariableDeclarator' &&
						Predicate.isNotNullish(definition.node.init) &&
						hasCauseField(context, definition.node.init))
			)
		)
	)
}

// `failure => X.make({message})` becomes `failure => X.make({cause: failure, message})`, `() => …` takes the failure as `cause`.
function fix(input: {context: Context; fixer: Fixer; node: ESTree.Node}) {
	if (input.node.type !== 'ArrowFunctionExpression' || input.node.async) return []
	const node = input.node
	const parameter = node.params[0]
	if (
		(Predicate.isNotNullish(parameter) && parameter.type !== 'Identifier') ||
		!declaresCause(input.context, returnedExpression(node))
	) {
		return []
	}
	return Option.getOrElse(
		Option.flatMap(constructedFields(returnedExpression(node)), fields => {
			if (Array.some(fields.properties, property => property.type === 'SpreadElement' || causeKey(property))) {
				return Option.none()
			}
			const insertion = insertField({field: causeField(parameter), fields, fixer: input.fixer})
			if (Predicate.isNotNullish(parameter)) return Option.some([insertion])
			const open = input.context.sourceCode.getFirstToken(node)
			const close = input.context.sourceCode.getTokenBefore(node.body, {filter: token => token.value === ')'})
			// A new `cause` parameter would hide an outer `cause` the body reads.
			if (
				open?.value !== '(' ||
				close === null ||
				Array.some(
					input.context.sourceCode.getScope(node.body).through,
					reference => reference.identifier.name === 'cause'
				)
			) {
				return Option.none()
			}
			return Option.some([input.fixer.replaceTextRange([open.range[0], close.range[1]], '(cause)'), insertion])
		}),
		() => []
	)
}

function report(context: Context, node: ESTree.Node) {
	context.report({
		fix: fixer => fix({context, fixer, node: resolveBinding(context, node)}),
		message: 'Keep the original failure as the new error’s cause: X.make({cause, message}).',
		node
	})
}

// The failure mapper of an options object, such as `catch` of Effect.tryPromise or `onFailure` of Effect.mapBoth.
function reportOption(context: Context, key: string, bare: boolean, options?: ESTree.Node) {
	if (options?.type !== 'ObjectExpression') return
	for (const property of options.properties) {
		if (
			property.type === 'Property' &&
			property.key.type === 'Identifier' &&
			property.key.name === key &&
			dropsCause(context, property.value, bare)
		) {
			report(context, property.value)
		}
	}
}

export const preserveErrorCause = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			const name = memberName(node.callee)
			if (Option.contains(name, 'mapError')) {
				const bare = detailedFailure(context, node)
				Array.forEach(
					Array.filter(node.arguments, argument => dropsCause(context, argument, bare)),
					callback => report(context, callback)
				)
				return
			}
			if (Option.contains(name, 'mapBoth')) {
				const bare = detailedFailure(context, node)
				Array.forEach(node.arguments, argument => reportOption(context, 'onFailure', bare, argument))
				return
			}
			if (!Option.exists(name, method => method === 'try' || method === 'tryPromise')) return
			reportOption(context, 'catch', true, node.arguments[0])
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
