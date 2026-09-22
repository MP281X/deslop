import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {schemaCycleNames} from './shared.ts'

function isTopLevelStatement(node: ESTree.TSTypeAliasDeclaration) {
	if (node.parent.type === 'Program') return true
	return node.parent.type === 'ExportNamedDeclaration' && node.parent.parent.type === 'Program'
}

function insideCycleType(input: {cycleNames: string[]; node: ESTree.Node}): boolean {
	if (input.node.type === 'Program') return false
	if (input.node.type === 'TSTypeAliasDeclaration' && isTopLevelStatement(input.node)) {
		return Array.contains(input.cycleNames, input.node.id.name)
	}
	return insideCycleType({cycleNames: input.cycleNames, node: input.node.parent})
}

export const noReadonlyTypeSyntax = defineRule({
	create: context => {
		let cycleNames = Option.none<string[]>()
		function exempt(node: ESTree.Node) {
			return Option.exists(cycleNames, names => insideCycleType({cycleNames: names, node}))
		}
		return {
			Program: program => {
				cycleNames = Option.some(schemaCycleNames({context, program}))
			},
			'Program:exit': () => {
				cycleNames = Option.none()
			},
			PropertyDefinition: node => {
				if (node.readonly === true) context.report({message: 'Remove the readonly type modifier.', node})
			},
			TSIndexSignature: node => {
				if (node.readonly) context.report({message: 'Remove the readonly index modifier.', node})
			},
			TSMappedType: node => {
				if (node.readonly === true || node.readonly === '+') {
					context.report({message: 'Remove the readonly mapped-type modifier.', node})
				}
			},
			TSParameterProperty: node => {
				if (node.readonly) context.report({message: 'Remove the readonly parameter-property modifier.', node})
			},
			TSPropertySignature: node => {
				if (node.readonly && !exempt(node)) context.report({message: 'Remove the readonly property modifier.', node})
			},
			TSTypeOperator: node => {
				if (node.operator === 'readonly' && !exempt(node)) {
					context.report({message: 'Use a mutable type shape.', node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
