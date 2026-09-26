import {Array, MutableRef, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {importedMember, schemaCycleNames} from './shared.ts'

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

function referencedName(node: ESTree.TSType) {
	if (node.type !== 'TSTypeReference') return Option.none<string>()
	if (node.typeName.type === 'Identifier') return Option.some(node.typeName.name)
	return node.typeName.type === 'TSQualifiedName' ? Option.some(node.typeName.right.name) : Option.none<string>()
}

export const noReadonlyTypeSyntax = defineRule({
	create: context => {
		const cycleNames = schemaCycleNames({context, program: context.sourceCode.ast})
		const shapes = MutableRef.make(Array.empty<ESTree.TSType>())
		const aliases = MutableRef.make(Array.empty<ESTree.TSTypeAliasDeclaration>())
		const properties = MutableRef.make(Array.empty<ESTree.TSPropertySignature>())
		const methods = MutableRef.make(Array.empty<ESTree.TSMethodSignature>())
		function exempt(node: ESTree.Node) {
			return insideCycleType({cycleNames, node})
		}
		return {
			CallExpression: node => {
				if (importedMember({context, importedName: 'Context', node: node.callee, propertyName: 'Service'})) {
					pipe(
						Option.fromNullishOr(node.typeArguments?.params[1]),
						Option.map(shape => MutableRef.update(shapes, Array.append(shape)))
					)
				}
			},
			'Program:exit': () => {
				const literals = pipe(
					MutableRef.get(shapes),
					Array.flatMap(shape => {
						if (shape.type === 'TSTypeLiteral') return [shape]
						const name = referencedName(shape)
						return pipe(
							MutableRef.get(aliases),
							Array.filter(alias => Option.contains(name, alias.id.name)),
							Array.map(alias => alias.typeAnnotation),
							Array.filter(type => type.type === 'TSTypeLiteral')
						)
					})
				)
				function inShape(node: ESTree.Node) {
					return Array.some(literals, literal => literal === node.parent)
				}
				for (const node of MutableRef.get(properties)) {
					if (inShape(node) && !node.readonly) {
						context.report({message: 'Mark this service property readonly.', node})
					}
					if (!inShape(node) && node.readonly && !exempt(node)) {
						context.report({message: 'Remove the readonly property modifier.', node})
					}
				}
				for (const node of MutableRef.get(methods)) {
					if (inShape(node)) {
						context.report({message: 'Write this service method as a readonly property holding a function.', node})
					}
				}
			},
			TSIndexSignature: node => {
				if (node.readonly) context.report({message: 'Remove the readonly index modifier.', node})
			},
			TSMappedType: node => {
				if (node.readonly === true || node.readonly === '+') {
					context.report({message: 'Remove the readonly mapped-type modifier.', node})
				}
			},
			TSMethodSignature: node => {
				MutableRef.update(methods, Array.append(node))
			},
			TSParameterProperty: node => {
				if (node.readonly) context.report({message: 'Remove the readonly parameter-property modifier.', node})
			},
			TSPropertySignature: node => {
				MutableRef.update(properties, Array.append(node))
			},
			TSTypeAliasDeclaration: node => {
				MutableRef.update(aliases, Array.append(node))
			},
			TSTypeOperator: node => {
				if (node.operator === 'readonly' && !exempt(node)) {
					context.report({message: 'Use a mutable type shape.', node})
				}
			},
			TSTypeReference: node => {
				if (node.typeName.type === 'Identifier' && node.typeName.name === 'Readonly' && !exempt(node)) {
					context.report({message: 'Use a mutable type shape.', node})
				}
			}
		}
	},
	meta: {type: 'problem'}
})
