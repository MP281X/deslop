import {Array, Option, Predicate, String} from 'effect'

import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {typeWrapped, variableFromScope} from '#lib/ast.ts'

function literal(node: ESTree.Node): boolean {
	if (node.type === 'Literal') return node.value !== null
	if (node.type === 'TemplateLiteral') return Array.isArrayEmpty(node.expressions)
	if (node.type === 'UnaryExpression') return node.operator === '-' && literal(node.argument)
	if (node.type === 'BinaryExpression') return literal(node.left) && literal(node.right)
	if (node.type === 'ArrayExpression') {
		return Array.every(
			node.elements,
			element => element !== null && element.type !== 'SpreadElement' && literal(element)
		)
	}
	if (node.type === 'ObjectExpression') {
		return Array.every(
			node.properties,
			property =>
				property.type === 'Property' && !property.computed && property.kind === 'init' && literal(property.value)
		)
	}
	return Option.exists(typeWrapped(node), literal)
}

export function literalConstant(statement: ESTree.Node) {
	if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const' || statement.declarations.length !== 1) {
		return Option.none()
	}
	const [node] = statement.declarations
	if (node?.id.type !== 'Identifier' || node.init === null || !literal(node.init)) return Option.none()
	return Option.some({id: node.id, node})
}

function primitive(node: ESTree.Node): boolean {
	if (node.type === 'Literal') return !Predicate.hasProperty(node, 'regex')
	return (
		Array.contains(['BinaryExpression', 'TemplateLiteral', 'UnaryExpression'], node.type) ||
		Option.exists(typeWrapped(node), primitive)
	)
}

export function singleUseModulePrimitive(context: Context, node: ESTree.VariableDeclarator) {
	if (
		node.parent.parent?.type !== 'Program' ||
		node.id.type !== 'Identifier' ||
		node.id.typeAnnotation !== null ||
		node.init === null ||
		!literal(node.init) ||
		!primitive(node.init) ||
		String.includes('\n')(context.sourceCode.getText(node))
	) {
		return false
	}
	return Option.exists(
		variableFromScope({name: node.id.name, scope: context.sourceCode.getScope(node)}),
		variable =>
			Array.countBy(variable.references, reference => reference.isRead()) === 1 &&
			!Array.some(variable.references, reference => reference.identifier.parent.type === 'ExportSpecifier')
	)
}
