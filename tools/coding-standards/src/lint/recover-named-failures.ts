import {Array, Function, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {
	childNodes,
	containsNode,
	effectMethod,
	importedMember,
	isImportBinding,
	memberName,
	matches,
	resolveBinding,
	returnedExpression,
	variableOf,
	variableFromScope
} from '#lib/ast.ts'

const REJECTING_APIS = [
	{methods: ['deleteItemAsync'], source: 'expo-secure-store'},
	{methods: ['setBadgeCountAsync', 'requestPermissionsAsync', 'getExpoPushTokenAsync'], source: 'expo-notifications'}
]

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

function insertField(input: {field: string; fields: ESTree.ObjectExpression; fixer: Fixer}) {
	return pipe(
		input.fields.properties,
		Array.findFirst(property => Option.exists(keyName(property), key => String.Order(key, 'cause') > 0)),
		Option.match({
			onNone: () =>
				Option.match(Array.last(input.fields.properties), {
					onNone: () => input.fixer.replaceText(input.fields, `{${input.field}}`),
					onSome: last => input.fixer.insertTextAfter(last, `, ${input.field}`)
				}),
			onSome: property => input.fixer.insertTextBefore(property, `${input.field}, `)
		})
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

// `cause: Schema.Defect()` takes any failure; a narrower field may reject the one being mapped.
function causeSchema(context: Context, node: ESTree.Node): boolean {
	if (node.type === 'MemberExpression') {
		return (
			importedMember({context, importedName: 'Schema', node}) &&
			Option.exists(memberName(node), name => name === 'Defect' || name === 'Unknown')
		)
	}
	if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false
	if (importedMember({context, importedName: 'Schema', node: node.callee, propertyName: 'Defect'})) return true
	return (
		(importedMember({context, importedName: 'Schema', node: node.callee, propertyName: 'optional'}) ||
			importedMember({context, importedName: 'Schema', node: node.callee, propertyName: 'optionalKey'})) &&
		Array.some(node.arguments, argument => argument.type !== 'SpreadElement' && causeSchema(context, argument))
	)
}

function hasCauseField(context: Context, node: ESTree.Node): boolean {
	if (
		node.type === 'ObjectExpression' &&
		Array.some(
			node.properties,
			property => causeKey(property) && property.type === 'Property' && causeSchema(context, property.value)
		)
	) {
		return true
	}
	return Array.some(childNodes(context, node), child => hasCauseField(context, child))
}

// The error is declared in this file with a `cause: Schema.Defect()` field; an imported one, or one with another field, is left to a person.
function declaresCause(context: Context, node?: ESTree.Node | null) {
	return Option.exists(constructedClass(node), name =>
		Option.exists(variableOf(context, name), variable =>
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
	return pipe(
		constructedFields(returnedExpression(node)),
		Option.flatMap(fields => {
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
		Option.getOrElse(() => [])
	)
}

function report(context: Context, node: ESTree.Node) {
	context.report({
		fix: fixer => fix({context, fixer, node: resolveBinding(context, node)}),
		message: 'Keep the original failure as the new error’s cause: X.make({cause, message}).',
		node
	})
}

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

function logged(context: Context, node: ESTree.Node) {
	return containsNode({
		context,
		matches: child =>
			child.type === 'CallExpression' &&
			child.callee.type === 'MemberExpression' &&
			importedMember({context, importedName: 'Effect', node: child.callee}) &&
			Option.exists(memberName(child.callee), matches(/^log(?:Trace|Debug|Info|Warning|Error|Fatal)$/u)),
		node,
		throughFunctions: true
	})
}

function rejection(context: Context, node: ESTree.Node) {
	return containsNode({
		context,
		matches: child => {
			if (child.type !== 'CallExpression') return false
			if (child.callee.type === 'Identifier') {
				return Array.some(REJECTING_APIS, api =>
					Array.some(
						api.methods,
						importedName =>
							child.callee.type === 'Identifier' &&
							isImportBinding({context, importedName, node: child.callee, source: api.source})
					)
				)
			}
			if (child.callee.type !== 'MemberExpression') return false
			if (child.callee.object.type === 'Identifier') {
				return Array.some(
					REJECTING_APIS,
					api =>
						child.callee.type === 'MemberExpression' &&
						child.callee.object.type === 'Identifier' &&
						isImportBinding({context, node: child.callee.object, source: api.source}) &&
						Option.exists(memberName(child.callee), name => Array.contains(api.methods, name))
				)
			}
			return (
				Option.contains(memberName(child.callee), 'downloadAsync') &&
				child.callee.object.type === 'CallExpression' &&
				child.callee.object.callee.type === 'MemberExpression' &&
				Option.contains(memberName(child.callee.object.callee), 'fromModule') &&
				child.callee.object.callee.object.type === 'Identifier' &&
				isImportBinding({context, importedName: 'Asset', node: child.callee.object.callee.object, source: 'expo-asset'})
			)
		},
		node,
		throughFunctions: false
	})
}

function messageTest(context: Context, node: ESTree.Node) {
	return containsNode({
		context,
		matches: child =>
			child.type === 'BinaryExpression' &&
			Array.contains(['===', '!==', '==', '!='], child.operator) &&
			Array.some(
				[child.left, child.right],
				side => side.type === 'MemberExpression' && Option.contains(memberName(side), 'message')
			),
		node,
		throughFunctions: true
	})
}

function loggedRecovery(context: Context, node: ESTree.CallExpression) {
	return (
		logged(context, node) ||
		(node.parent.type === 'CallExpression' &&
			node.parent.callee.type === 'Identifier' &&
			isImportBinding({context, importedName: 'pipe', node: node.parent.callee, source: 'effect'}) &&
			Array.some(
				node.parent.arguments,
				step =>
					step.type === 'CallExpression' &&
					Option.exists(
						effectMethod({context, node: step}),
						method => method === 'tapError' || method === 'tapCause'
					) &&
					logged(context, step)
			))
	)
}

function checkPromise(context: Context, node: ESTree.CallExpression) {
	const callback = node.arguments[0]
	if (callback === undefined) return
	const resolved = resolveBinding(context, callback)
	if (
		resolved.type !== 'ArrowFunctionExpression' &&
		resolved.type !== 'FunctionExpression' &&
		resolved.type !== 'FunctionDeclaration'
	)
		{return}
	const returned = returnedExpression(resolved)
	if (Predicate.isNotNullish(returned) && rejection(context, returned)) {
		context.report({
			message:
				'Wrap rejecting I/O in Effect.tryPromise({try, catch}); keep the original failure as the typed error’s cause.',
			node
		})
	}
}

export const recoverNamedFailures = defineRule({
	create: context => ({
		CallExpression: node => {
			const name = effectMethod({context, node})
			if (Option.exists(name, method => Array.contains(['catch', 'catchCause', 'orElseSucceed'], method))) {
				if (loggedRecovery(context, node)) return
				context.report({
					message:
						'Recover with Effect.catchTag for a named failure, use Effect.option for absence, or log the failure before recovering; do not turn every failure into an ordinary result.',
					node
				})
				return
			}
			if (Option.contains(name, 'promise')) {
				checkPromise(context, node)
				return
			}
			if (Option.exists(name, method => method === 'catchIf' || method === 'retry') && messageTest(context, node)) {
				context.report({message: 'Choose recovery or retry by a typed reason or tag, not message wording.', node})
				return
			}
			if (Option.contains(name, 'mapError')) {
				const bare = detailedFailure(context, node)
				pipe(
					node.arguments,
					Array.filter(argument => dropsCause(context, argument, bare)),
					Array.forEach(callback => report(context, callback))
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
		},
		MemberExpression: node => {
			if (!importedMember({context, importedName: 'Effect', node})) return
			const method = Option.getOrElse(memberName(node), Function.constant(''))
			if (!Array.contains(['ignore', 'ignoreCause', 'orDie', 'orDieWith'], method)) return
			if (
				Array.contains(['ignore', 'ignoreCause'], method) &&
				node.parent.type === 'CallExpression' &&
				Array.some(
					node.parent.arguments,
					argument =>
						argument.type === 'ObjectExpression' &&
						Array.every(argument.properties, property => property.type === 'Property') &&
						Array.some(
							argument.properties,
							property =>
								!property.computed &&
								property.key.type === 'Identifier' &&
								property.key.name === 'log' &&
								property.value.type === 'Literal' &&
								(property.value.value === true || Predicate.isString(property.value.value))
						)
				)
			) {
				return
			}
			context.report({
				message:
					'Keep the typed failure with its cause, or log best-effort work with Effect.ignore({log: "Warn", message}); do not drop it or turn it into a defect.',
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
