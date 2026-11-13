import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	containsNode,
	effectImport,
	effectMethod,
	importedMember,
	isFunction,
	isImportBinding,
	memberName,
	resolveBinding
} from '#lib/ast.ts'

// These constructors and fully applied combinators return an Effect, unlike predicates, runners and curried combinators.
function effectCall(context: Context, node: ESTree.Node, inPipe: boolean) {
	if (node.type === 'MemberExpression') {
		return importedMember({context, importedName: 'Effect', node, propertyName: 'void'})
	}
	if (node.type !== 'CallExpression') return false
	return Option.exists(effectMethod({context, node}), method => {
		if (
			Array.contains(
				['gen', 'succeed', 'fail', 'die', 'sync', 'suspend', 'try', 'promise', 'tryPromise', 'sleep', 'all'],
				method
			)
		) {
			return Array.isReadonlyArrayNonEmpty(node.arguments)
		}
		if (Array.contains(['map', 'flatMap', 'tap', 'as', 'andThen', 'catch', 'mapError', 'forEach'], method)) {
			return inPipe || node.arguments.length >= 2
		}
		return method === 'asVoid' && (inPipe || Array.isReadonlyArrayNonEmpty(node.arguments))
	})
}

function returnsEffect(context: Context, value: ESTree.Node) {
	const node = resolveBinding(context, value)
	if (effectCall(context, node, false)) return true
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
	return Option.exists(last, step => effectCall(context, step, true))
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

// Native effectFnOpportunity does not require public methods to trace; effect and stream values stay with review.
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
				Option.match(untraced(context, node.value), {
					onNone: () => {
						if (!effectArrow(context, node.value)) return
						context.report({
							fix: fixer =>
								pipe(
									effectImport({context, fixer, name: 'Effect', node}),
									Option.map(imports => [
										...imports,
										fixer.replaceText(node.value, `Effect.fn('${name}')(${context.sourceCode.getText(node.value)})`)
									]),
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
	meta: {fixable: 'code', type: 'problem'}
})
