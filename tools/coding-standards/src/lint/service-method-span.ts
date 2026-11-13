import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, memberName} from '#lib/ast.ts'

function serviceClass(context: Context, node: ESTree.Node): Option.Option<ESTree.ClassDeclaration> {
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

// Native effectFnOpportunity does not require public methods to trace; aliases and stream lifetimes need review.
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
				node.key.type !== 'Identifier' ||
				node.value.type !== 'CallExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.value.callee, propertyName: 'fnUntraced'})
			) {
				return
			}
			const method = node.key.name
			const callee = node.value.callee
			Option.map(serviceClass(context, node), service => {
				if (service.id === null || callee.type !== 'MemberExpression') return
				const name = `${service.id.name}.${method}`
				context.report({
					fix: fixer => fixer.replaceText(callee, `${context.sourceCode.getText(callee.object)}.fn('${name}')`),
					message: `Trace this public service method with Effect.fn('${name}').`,
					node: callee
				})
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
