import {Array, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {
	importedMember,
	isImportBinding,
	isInferredType,
	isSchemaOperationName,
	memberName,
	schemaCycleNames,
	schemaSchemaType,
	statementDeclaration,
	typeAlias
} from './shared.ts'

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
	if (
		input.node.type === 'CallExpression' &&
		input.node.callee.type === 'MemberExpression' &&
		!importedMember({context: input.context, importedName: 'Schema', node: input.node.callee}) &&
		Option.contains(memberName(input.node.callee), 'make')
	) {
		return false
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

function namedTypeAlias(input: {
	name: string
	typeStatement: Option.Option<ESTree.Statement | ESTree.ModuleDeclaration>
}) {
	return pipe(
		input.typeStatement,
		Option.flatMap(typeAlias),
		Option.filter(declaration => declaration.id.name === input.name)
	)
}

function reportSchemaVariable(input: {
	context: Context
	cycleNames: string[]
	program: ESTree.Program
	statement: ESTree.Statement
	variable: ESTree.VariableDeclarator
}) {
	if (input.variable.id.type !== 'Identifier' || !/^[A-Z]/u.test(input.variable.id.name)) return
	if (input.variable.init === null || !isSchemaDefinition({context: input.context, node: input.variable.init})) return
	const name = input.variable.id.name
	const annotation = input.variable.id.typeAnnotation
	const typeStatement = pipe(
		input.program.body,
		Array.findFirstIndex(statement => statement === input.statement),
		Option.filter(index => index > 0),
		Option.flatMap(index => Array.get(input.program.body, index - 1))
	)
	if (Array.contains(input.cycleNames, name)) {
		if (
			!pipe(
				namedTypeAlias({name, typeStatement}),
				Option.exists(declaration => !isInferredType({name, node: declaration.typeAnnotation}))
			)
		) {
			input.context.report({
				message: `Write \`type ${name} = ...\` by hand immediately before this recursive Schema; typeof ${name}.Type is circular.`,
				node: input.variable
			})
		}
		if (annotation !== null && annotation !== undefined) {
			input.context.report({
				message: 'Annotate the Schema.suspend thunk, not the recursive Schema.',
				node: input.variable.id
			})
		}
		return
	}
	if (
		!pipe(
			namedTypeAlias({name, typeStatement}),
			Option.exists(declaration => isInferredType({name, node: declaration.typeAnnotation}))
		)
	) {
		input.context.report({
			message: `Place \`type ${name} = typeof ${name}.Type\` immediately before this Schema.`,
			node: input.variable
		})
	}
	if (
		input.variable.init.type === 'TSSatisfiesExpression' &&
		schemaSchemaType({context: input.context, node: input.variable.init.typeAnnotation})
	) {
		input.context.report({message: 'Infer this schema instead of restating Schema.Schema.', node: input.variable.init})
	}
	if (
		annotation !== null &&
		annotation !== undefined &&
		schemaSchemaType({context: input.context, node: annotation.typeAnnotation})
	) {
		input.context.report({message: 'Infer this schema instead of annotating Schema.Schema.', node: input.variable.id})
	}
}

export const schemaTypePair = defineRule({
	createOnce: context => ({
		'Program:exit': program => {
			const cycleNames = schemaCycleNames({context, program})
			for (const statement of program.body) {
				const declaration = statementDeclaration(statement)
				if (declaration?.type === 'VariableDeclaration') {
					for (const variable of declaration.declarations) {
						reportSchemaVariable({context, cycleNames, program, statement, variable})
					}
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
