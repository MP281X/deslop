import {Array, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, isImportBinding, isSchemaOperationName, memberName} from './shared.ts'

function expressionRoot(node: ESTree.Expression): ESTree.Expression {
	if (node.type === 'MemberExpression') return expressionRoot(node.object)
	if (node.type === 'CallExpression' && node.callee.type !== 'Super') return expressionRoot(node.callee)
	if (node.type === 'ChainExpression') return expressionRoot(node.expression)
	if (node.type === 'TSInstantiationExpression') return expressionRoot(node.expression)
	if (node.type === 'TSSatisfiesExpression') return expressionRoot(node.expression)
	return node
}

function expressionUsesImport(input: {context: Context; importedName: string; node: ESTree.Expression}) {
	const root = expressionRoot(input.node)
	return (
		root.type === 'Identifier' &&
		isImportBinding({context: input.context, importedName: input.importedName, node: root, source: 'effect'})
	)
}

function schemaDefinitionMember(node: ESTree.Expression): Option.Option<ESTree.MemberExpression> {
	if (node.type === 'CallExpression' && node.callee.type !== 'Super') return schemaDefinitionMember(node.callee)
	if (node.type === 'TSInstantiationExpression') return schemaDefinitionMember(node.expression)
	if (node.type === 'TSSatisfiesExpression') return schemaDefinitionMember(node.expression)
	if (node.type === 'MemberExpression') {
		if (node.object.type === 'Identifier') return Option.some(node)
		if (node.object.type !== 'Super') return schemaDefinitionMember(node.object)
	}
	return Option.none()
}

function isSchemaDefinitionName(name: string) {
	return !isSchemaOperationName(name) && !/^to[A-Z]/u.test(name)
}

function isSchemaDefinition(input: {context: Context; node: ESTree.Expression}): boolean {
	if (
		input.node.type === 'CallExpression' &&
		input.node.callee.type === 'Identifier' &&
		isImportBinding({context: input.context, importedName: 'pipe', node: input.node.callee, source: 'effect'}) &&
		input.node.arguments[0] !== undefined &&
		input.node.arguments[0].type !== 'SpreadElement'
	) {
		return isSchemaDefinition({context: input.context, node: input.node.arguments[0]})
	}
	if (input.node.type === 'TSSatisfiesExpression') {
		return isSchemaDefinition({context: input.context, node: input.node.expression})
	}
	if (!expressionUsesImport({context: input.context, importedName: 'Schema', node: input.node})) return false
	return pipe(
		schemaDefinitionMember(input.node),
		Option.exists(member => {
			if (!importedMember({context: input.context, importedName: 'Schema', node: member})) return false
			return pipe(memberName(member), Option.exists(isSchemaDefinitionName))
		})
	)
}

function statementDeclaration(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	return statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
}

function previousStatement(input: {program: ESTree.Program; statement: ESTree.Statement}) {
	return pipe(
		input.program.body,
		Array.findFirstIndex(statement => statement === input.statement),
		Option.filter(index => index > 0),
		Option.flatMap(index => Array.get(input.program.body, index - 1))
	)
}

function matchingSchemaType(input: {
	name: string
	typeStatement: Option.Option<ESTree.Statement | ESTree.ModuleDeclaration>
}) {
	return pipe(
		input.typeStatement,
		Option.exists(typeStatement => {
			const declaration = statementDeclaration(typeStatement)
			return (
				declaration?.type === 'TSTypeAliasDeclaration' &&
				declaration.id.name === input.name &&
				declaration.typeAnnotation.type === 'TSTypeQuery' &&
				declaration.typeAnnotation.exprName.type === 'TSQualifiedName' &&
				declaration.typeAnnotation.exprName.left.type === 'Identifier' &&
				declaration.typeAnnotation.exprName.left.name === input.name &&
				declaration.typeAnnotation.exprName.right.name === 'Type'
			)
		})
	)
}

function schemaSchemaType(input: {context: Context; node: ESTree.TSType}) {
	return (
		input.node.type === 'TSTypeReference' &&
		input.node.typeName.type === 'TSQualifiedName' &&
		input.node.typeName.left.type === 'Identifier' &&
		input.node.typeName.left.name === 'Schema' &&
		input.node.typeName.right.name === 'Schema' &&
		isImportBinding({context: input.context, importedName: 'Schema', node: input.node.typeName.left, source: 'effect'})
	)
}

export const schemaTypePair = defineRule({
	createOnce: context => ({
		Program: program => {
			for (const statement of program.body) {
				const declaration = statementDeclaration(statement)
				if (declaration?.type === 'VariableDeclaration') {
					for (const variable of declaration.declarations) {
						if (
							variable.id.type === 'Identifier' &&
							/^[A-Z]/u.test(variable.id.name) &&
							variable.init !== null &&
							isSchemaDefinition({context, node: variable.init})
						) {
							if (
								!matchingSchemaType({name: variable.id.name, typeStatement: previousStatement({program, statement})})
							) {
								context.report({
									message: `Place \`type ${variable.id.name} = typeof ${variable.id.name}.Type\` immediately before this Schema.`,
									node: variable
								})
							}
							if (
								variable.init.type === 'TSSatisfiesExpression' &&
								schemaSchemaType({context, node: variable.init.typeAnnotation})
							) {
								context.report({message: 'Infer this schema instead of restating Schema.Schema.', node: variable.init})
							}
							const annotation = variable.id.typeAnnotation
							if (
								annotation !== null &&
								annotation !== undefined &&
								schemaSchemaType({context, node: annotation.typeAnnotation})
							) {
								context.report({message: 'Infer this schema instead of annotating Schema.Schema.', node: variable.id})
							}
						}
					}
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
