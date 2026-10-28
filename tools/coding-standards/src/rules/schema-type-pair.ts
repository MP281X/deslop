import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	importedMember,
	isImportBinding,
	isInferredType,
	isSchemaOperationName,
	matches,
	memberName,
	schemaCycleNames,
	schemaSchemaType,
	statementDeclaration,
	typeAlias,
	variableFromScope
} from '#rules/shared.ts'

const EXPORT_PREFIXES: Record<string, string> = {ExportNamedDeclaration: 'export '}

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
			return pipe(
				memberName(member),
				Option.exists(
					name =>
						!isSchemaOperationName(name) &&
						!matches(/^(?:is|to)[A-Z]/u)(name) &&
						!matches(/^makeFilter(?:Group)?$/u)(name)
				)
			)
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

// The type goes in front only when the statement declares this Schema alone and nothing else in the file is named after it.
function pairable(input: {
	context: Context
	name: string
	program: ESTree.Program
	statement: ESTree.Statement
	variable: ESTree.VariableDeclarator
}) {
	const declaration = statementDeclaration(input.statement)
	return (
		declaration?.type === 'VariableDeclaration' &&
		declaration.declarations.length === 1 &&
		!Array.some(input.program.body, statement => {
			const named = statementDeclaration(statement)
			return (
				(named?.type === 'TSTypeAliasDeclaration' || named?.type === 'TSInterfaceDeclaration') &&
				named.id.name === input.name
			)
		}) &&
		Option.exists(
			variableFromScope({name: input.name, scope: input.context.sourceCode.getScope(input.variable)}),
			variable => variable.defs.length === 1
		)
	)
}

function reportSchemaVariable(input: {
	context: Context
	cycleNames: string[]
	program: ESTree.Program
	statement: ESTree.Statement
	variable: ESTree.VariableDeclarator
}) {
	if (input.variable.id.type !== 'Identifier' || !matches(/^[A-Z]/u)(input.variable.id.name)) return
	if (input.variable.init === null || !isSchemaDefinition({context: input.context, node: input.variable.init})) return
	const name = input.variable.id.name

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
		if (Predicate.isNotNullish(input.variable.id.typeAnnotation)) {
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
			fix: fixer => {
				if (!pairable({...input, name})) return []
				const start = pipe(
					input.context.sourceCode.getCommentsBefore(input.statement),
					Array.head,
					Option.getOrElse(() => input.statement)
				).range[0]
				return [
					fixer.insertTextBeforeRange(
						[start, start],
						`${EXPORT_PREFIXES[input.statement.type] ?? ''}type ${name} = typeof ${name}.Type\n`
					)
				]
			},
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
		Predicate.isNotNullish(input.variable.id.typeAnnotation) &&
		schemaSchemaType({context: input.context, node: input.variable.id.typeAnnotation.typeAnnotation})
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
		},
		// `typeof Note.Type` outside its pair repeats the derivation the alias names.
		TSTypeQuery: node => {
			if (
				node.exprName.type !== 'TSQualifiedName' ||
				node.exprName.left.type !== 'Identifier' ||
				node.exprName.right.name !== 'Type' ||
				!matches(/^[A-Z]/u)(node.exprName.left.name) ||
				(node.parent.type === 'TSTypeAliasDeclaration' && isInferredType({name: node.parent.id.name, node}))
			) {
				return
			}
			context.report({
				message: `Read the type ${node.exprName.left.name}, declared as \`type ${node.exprName.left.name} = typeof ${node.exprName.left.name}.Type\` beside its Schema.`,
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
