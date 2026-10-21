import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

// A schema's own members describe its type, so `typeof X.Type` and `typeof X.literals` stay.
function schemaMember(name: ESTree.TSTypeName) {
	return (
		name.type === 'TSQualifiedName' &&
		Array.contains(['Encoded', 'Type', 'cases', 'fields', 'literals', 'members'], name.right.name)
	)
}

// `typeof table` and `typeof owner.table` read a value written for something else.
function valueQuery(node: ESTree.TSType): boolean {
	if (node.type === 'TSParenthesizedType') return valueQuery(node.typeAnnotation)
	if (node.type === 'TSIndexedAccessType') return valueQuery(node.objectType)
	return (
		node.type === 'TSTypeQuery' &&
		(node.exprName.type === 'Identifier' || (node.exprName.type === 'TSQualifiedName' && !schemaMember(node.exprName)))
	)
}

// An indexed access inside another one's object is reported once, at the outer access.
function nestedObject(node: ESTree.Node) {
	return node.parent?.type === 'TSIndexedAccessType' && node.parent.objectType === node
}

export const noTypeFromValue = defineRule({
	create: context => {
		function report(node: ESTree.Node) {
			context.report({
				message: 'Declare the closed set as a schema, such as Schema.Literals, and read its type with typeof X.Type.',
				node
			})
		}
		return {
			TSIndexedAccessType: node => {
				if (!nestedObject(node) && valueQuery(node.objectType)) report(node)
			},
			TSTypeOperator: node => {
				if (node.operator === 'keyof' && !nestedObject(node) && valueQuery(node.typeAnnotation)) report(node)
			}
		}
	},
	meta: {type: 'problem'}
})
