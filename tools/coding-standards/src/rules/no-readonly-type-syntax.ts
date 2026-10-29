import {Array, HashSet, MutableHashSet, MutableList, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, schemaCycleNames, statementDeclaration, variableFromScope} from '#rules/shared.ts'

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

function typeDeclarations(input: {context: Context; name: ESTree.TSTypeName}): ESTree.Node[] {
	if (input.name.type === 'Identifier') {
		return pipe(
			variableFromScope({name: input.name.name, scope: input.context.sourceCode.getScope(input.name)}),
			Option.flatMap(variable => {
				if (
					variable.scope.block.type !== 'ClassDeclaration' ||
					!Array.some(variable.defs, definition => definition.node === variable.scope.block)
				) {
					return Option.some(variable)
				}
				return variableFromScope({name: variable.name, scope: variable.scope.upper})
			}),
			Option.map(variable => Array.map(variable.defs, definition => definition.node)),
			Option.getOrElse(() => Array.empty<ESTree.Node>())
		)
	}
	if (input.name.type !== 'TSQualifiedName') return []
	const name = input.name
	return pipe(
		typeDeclarations({context: input.context, name: name.left}),
		Array.flatMap(declaration => {
			if (declaration.type !== 'TSModuleDeclaration' || declaration.body === null) return []
			return pipe(
				declaration.body.body,
				Array.map(statementDeclaration),
				Array.filter(node => node !== null)
			)
		}),
		Array.filter(
			declaration =>
				(declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSModuleDeclaration') &&
				declaration.id.type === 'Identifier' &&
				declaration.id.name === name.right.name
		)
	)
}

function shapeLiterals(input: {
	context: Context
	seen: MutableHashSet.MutableHashSet<number>
	type: ESTree.TSType
}): ESTree.TSType[] {
	if (input.type.type === 'TSTypeLiteral') return [input.type]
	if (input.type.type === 'TSUnionType' || input.type.type === 'TSIntersectionType') {
		return Array.flatMap(input.type.types, type => shapeLiterals({...input, type}))
	}
	if (input.type.type === 'TSParenthesizedType') return shapeLiterals({...input, type: input.type.typeAnnotation})
	if (input.type.type !== 'TSTypeReference') return []
	return pipe(
		typeDeclarations({context: input.context, name: input.type.typeName}),
		Array.filter(declaration => declaration.type === 'TSTypeAliasDeclaration'),
		Array.flatMap(alias => {
			if (MutableHashSet.has(input.seen, alias.range[0])) return []
			MutableHashSet.add(input.seen, alias.range[0])
			return shapeLiterals({...input, type: alias.typeAnnotation})
		})
	)
}

export const noReadonlyTypeSyntax = defineRule({
	create: context => {
		const cycleNames = schemaCycleNames({context, program: context.sourceCode.ast})
		const shapes = MutableList.make<ESTree.TSType>()
		const properties = MutableList.make<ESTree.TSPropertySignature>()
		const accessors = MutableList.make<ESTree.TSMethodSignature>()
		function exempt(node: ESTree.Node) {
			return insideCycleType({cycleNames, node})
		}
		return {
			CallExpression: node => {
				if (importedMember({context, importedName: 'Context', node: node.callee, propertyName: 'Service'})) {
					pipe(
						Option.fromNullishOr(node.typeArguments?.params[1]),
						Option.map(shape => MutableList.append(shapes, shape))
					)
				}
			},
			'Program:exit': () => {
				const seen = MutableHashSet.empty<number>()
				const literals = pipe(
					MutableList.toArray(shapes),
					Array.flatMap(shape => shapeLiterals({context, seen, type: shape})),
					Array.map(literal => literal.range[0]),
					HashSet.fromIterable
				)
				function inShape(node: ESTree.TSPropertySignature | ESTree.TSMethodSignature) {
					return HashSet.has(literals, node.parent.range[0])
				}
				for (const node of MutableList.toArray(properties)) {
					if (inShape(node) && !node.readonly) {
						context.report({
							fix: fixer => fixer.insertTextBefore(node, 'readonly '),
							message: 'Mark this service property readonly.',
							node
						})
					}
					if (!inShape(node) && node.readonly && !exempt(node)) {
						context.report({message: 'Remove the readonly property modifier.', node})
					}
				}
				for (const node of MutableList.toArray(accessors)) {
					if (inShape(node)) {
						context.report({message: 'Write this service accessor as a readonly property.', node})
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
				if (node.kind !== 'method') MutableList.append(accessors, node)
			},
			TSPropertySignature: node => {
				MutableList.append(properties, node)
			},
			// No removal fix: a readonly array is not assignable to a mutable one, a `unique symbol` key must stay readonly, an aliased condition (`const known = row.id !== null`) narrows only readonly properties, and exact type tests compare the modifier.
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
	meta: {fixable: 'code', type: 'problem'}
})
