import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, memberName, variableFromScope} from '#lib/ast.ts'

function untraced(context: Context, value: ESTree.Node) {
	return pipe(
		value,
		Option.liftPredicate(node => node.type === 'Identifier'),
		Option.match({
			onNone: () => Option.some(value),
			onSome: identifier =>
				pipe(
					variableFromScope({name: identifier.name, scope: context.sourceCode.getScope(identifier)}),
					Option.flatMap(variable => Array.findFirst(variable.defs, definition => definition.type === 'Variable')),
					Option.flatMap(definition => {
						if (definition.node.type !== 'VariableDeclarator') return Option.none()
						if (definition.node.init === null) return Option.none()
						return Option.some<ESTree.Node>(definition.node.init)
					})
				)
		}),
		Option.filter(node => node.type === 'CallExpression'),
		Option.map(node => node.callee),
		Option.filter(callee => importedMember({context, importedName: 'Effect', node: callee, propertyName: 'fnUntraced'}))
	)
}

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

// Native effectFnOpportunity does not require public methods to trace; effect and stream values need review.
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
			Option.map(Option.all([serviceClass(context, node), untraced(context, node.value)]), pair => {
				const service = pair[0]
				const callee = pair[1]
				if (service.id === null || callee.type !== 'MemberExpression') return
				if (node.parent.parent?.type === 'CallExpression' && node.parent.parent.callee.type === 'MemberExpression') {
					if (
						node.parent.parent.callee.object.type !== 'ThisExpression' &&
						!(
							node.parent.parent.callee.object.type === 'Identifier' &&
							node.parent.parent.callee.object.name === service.id.name
						)
					)
						return
				}
				if (node.parent.parent?.type === 'ReturnStatement') {
					const factory = node.parent.parent.parent.parent?.parent?.parent
					if (factory?.type !== 'Property' || factory.key.type !== 'Identifier' || factory.key.name !== 'make') return
				}
				const name = `${service.id.name}.${method}`
				context.report({
					fix: fixer => fixer.replaceText(callee, `${context.sourceCode.getText(callee.object)}.fn('${name}')`),
					message: `Trace this public service method with Effect.fn('${name}').`,
					node: node.key
				})
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
