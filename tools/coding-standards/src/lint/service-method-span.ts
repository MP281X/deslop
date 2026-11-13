import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	containsNode,
	childNodes,
	effectImport,
	effectMethod,
	importedMember,
	isFunction,
	isImportBinding,
	memberName,
	resolveBinding
} from '#lib/ast.ts'

// Predicates and runners inspect or execute Effects; withSpan already supplies the boundary checked below.
function effectCall(context: Context, node: ESTree.Node): boolean {
	if (node.type === 'CallExpression') return effectCall(context, node.callee)
	if (node.type !== 'MemberExpression' || !importedMember({context, importedName: 'Effect', node})) return false
	return Option.exists(
		memberName(node),
		method => method !== 'withSpan' && Option.isNone(String.match(/^(?:is|run)(?:[A-Z]|$)/u)(method))
	)
}

function returnsEffect(context: Context, value: ESTree.Node) {
	const node = resolveBinding(context, value)
	if (effectCall(context, node)) return true
	if (
		node.type !== 'CallExpression' ||
		node.callee.type !== 'Identifier' ||
		!isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	) {
		return false
	}
	const last = Array.last(node.arguments)
	if (
		Option.exists(
			last,
			step => step.type === 'CallExpression' && Option.contains(effectMethod({context, node: step}), 'withSpan')
		)
	) {
		return false
	}
	return Option.exists(last, step => effectCall(context, step))
}

function returnValues(context: Context, node: ESTree.Node): ESTree.Node[] {
	if (node.type === 'ReturnStatement') return Option.toArray(Option.fromNullishOr(node.argument))
	if (isFunction(node)) return []
	return Array.flatMap(childNodes(context, node), child => returnValues(context, child))
}

function spanNames(context: Context, value: ESTree.Node): ESTree.Node[] {
	const node = resolveBinding(context, value)
	if (node.type === 'ArrowFunctionExpression') {
		if (node.body.type !== 'BlockStatement') return spanNames(context, node.body)
		return Array.flatMap(returnValues(context, node.body), returned => spanNames(context, returned))
	}
	if (node.type !== 'CallExpression') return []
	if (Option.contains(effectMethod({context, node}), 'withSpan')) return Option.toArray(Array.get(node.arguments, 1))
	if (Option.contains(effectMethod({context, node}), 'fn')) return Option.toArray(Array.head(node.arguments))
	if (node.callee.type === 'CallExpression' && Option.contains(effectMethod({context, node: node.callee}), 'fn')) {
		return Option.toArray(Array.head(node.callee.arguments))
	}
	if (
		node.callee.type !== 'Identifier' ||
		!isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	) {
		return []
	}
	return pipe(
		node.arguments,
		Array.last,
		Option.flatMap(step => {
			if (step.type !== 'CallExpression' || !Option.contains(effectMethod({context, node: step}), 'withSpan')) {
				return Option.none()
			}
			return Array.head(step.arguments)
		}),
		Option.toArray
	)
}

function untraced(context: Context, value: ESTree.Node) {
	const node = resolveBinding(context, value)
	if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
		if (importedMember({context, importedName: 'Effect', node: node.callee, propertyName: 'fnUntraced'})) {
			return Option.some(node.callee)
		}
		if (
			importedMember({context, importedName: 'Effect', node: node.callee, propertyName: 'fn'}) &&
			Option.exists(Array.head(node.arguments), isFunction)
		) {
			return Option.some(node.callee)
		}
	}
	return Option.none<ESTree.MemberExpression>()
}

// Tick-rate methods need a site-local reasoned disable because animation-tick tracing is forbidden.
function effectArrow(context: Context, value: ESTree.Node) {
	const node = resolveBinding(context, value)
	if (node.type !== 'ArrowFunctionExpression') return false
	if (node.body.type !== 'BlockStatement') return returnsEffect(context, node.body)
	return containsNode({
		context,
		matches: child =>
			child.type === 'ReturnStatement' && child.argument !== null && returnsEffect(context, child.argument),
		node: node.body,
		throughFunctions: false
	})
}

// Follow syntax, not a fixed parent depth: wrappers around a visible Effect.gen do not hide its factory.
function makeProperty(node: ESTree.Node): boolean {
	if (node.type === 'Property' || node.type === 'PropertyDefinition') {
		return node.key.type === 'Identifier' && node.key.name === 'make'
	}
	if (node.type !== 'CallExpression' && node.type !== 'MemberExpression') return false
	return makeProperty(node.parent)
}

// Review owns opaque make wrappers without a visible Effect.gen factory.
function factoryReturn(context: Context, node: ESTree.Node): boolean {
	if (node.parent === null) return false
	if (isFunction(node)) {
		return (
			node.parent.type === 'CallExpression' &&
			node.parent.callee.type !== 'Super' &&
			importedMember({context, importedName: 'Effect', node: node.parent.callee, propertyName: 'gen'}) &&
			makeProperty(node.parent.parent)
		)
	}
	return factoryReturn(context, node.parent)
}

// Review owns service objects built outside the class, such as AiProxy's module-level make.
function serviceClass(context: Context, node: ESTree.Node): Option.Option<ESTree.Class> {
	if (node.type === 'ClassDeclaration') {
		function serviceBase(base: ESTree.Expression): boolean {
			if (base.type === 'CallExpression') return base.callee.type !== 'Super' && serviceBase(base.callee)
			return importedMember({context, importedName: 'Context', node: base, propertyName: 'Service'})
		}
		return Option.filter(
			Option.some(node),
			declaration => declaration.superClass !== null && serviceBase(declaration.superClass)
		)
	}
	if (node.parent === null) return Option.none()
	return serviceClass(context, node.parent)
}

// Review owns opaque calls, dynamic span names and effect/stream values; native effectFnOpportunity does not require spans.
export const serviceMethodSpan = defineRule({
	create: context => ({
		Property: node => {
			if (
				node.parent.type !== 'ObjectExpression' ||
				!(
					node.parent.parent.type === 'ReturnStatement' ||
					(node.parent.parent.type === 'CallExpression' &&
						node.parent.parent.callee.type === 'MemberExpression' &&
						Option.contains(memberName(node.parent.parent.callee), 'of'))
				) ||
				node.key.type !== 'Identifier'
			) {
				return
			}
			const method = node.key.name
			Option.map(serviceClass(context, node), service => {
				if (service.id === null) return
				if (node.parent.parent?.type === 'CallExpression' && node.parent.parent.callee.type === 'MemberExpression') {
					if (
						node.parent.parent.callee.object.type !== 'ThisExpression' &&
						!(
							node.parent.parent.callee.object.type === 'Identifier' &&
							node.parent.parent.callee.object.name === service.id.name
						)
					) {
						return
					}
				}
				if (node.parent.parent?.type === 'ReturnStatement') {
					if (!factoryReturn(context, node.parent.parent)) return
				}
				const name = `${service.id.name}.${method}`
				Array.forEach(spanNames(context, node.value), literal => {
					if (literal.type !== 'Literal' || !Predicate.isString(literal.value) || literal.value === name) return
					context.report({
						// A bound function can serve other methods, so its shared definition needs a manual fix.
						fix: fixer => {
							if (literal.range[0] < node.value.range[0] || literal.range[1] > node.value.range[1]) return
							return fixer.replaceText(literal, `'${name}'`)
						},
						message: `Name this public service span '${name}'.`,
						node: literal
					})
				})
				Option.match(untraced(context, node.value), {
					onNone: () => {
						if (!effectArrow(context, node.value)) return
						context.report({
							fix: fixer =>
								pipe(
									effectImport({context, fixer, name: 'Effect', node}),
									Option.map(imports => {
										const wrapped = `Effect.fn('${name}')(${context.sourceCode.getText(node.value)})`
										if (node.shorthand) {
											return [
												...imports,
												fixer.replaceText(node, `${context.sourceCode.getText(node.key)}: ${wrapped}`)
											]
										}
										return [...imports, fixer.replaceText(node.value, wrapped)]
									}),
									Option.getOrUndefined
								),
							message: `Trace this public service method with Effect.fn('${name}').`,
							node: node.key
						})
					},
					onSome: callee =>
						context.report({
							fix: fixer => fixer.replaceText(callee, `${context.sourceCode.getText(callee.object)}.fn('${name}')`),
							message: `Trace this public service method with Effect.fn('${name}').`,
							node: node.key
						})
				})
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Clock, Context, Effect} from 'effect'
export class Notes extends Context.Service<Notes>()('service-method-span/accepted-0/sample/Notes', {make: Effect.gen(function* () {
yield* Effect.logDebug('start')
return {read: Effect.fn('Notes.read')(function* () { yield* Effect.logDebug('read'); return yield* Clock.currentTimeMillis })}
})}) {}`
					}
				],
				fixes: [
					{
						'sample.ts': `import {Clock, Context, Effect} from 'effect'
export class Notes extends Context.Service<Notes>()('service-method-span/fixes-0/sample/Notes', {make: Effect.gen(function* () {
yield* Effect.logDebug('start')
return {read: Effect.fnUntraced(function* () { yield* Effect.logDebug('read'); return yield* Clock.currentTimeMillis })}
})}) {}`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
