import {Array, MutableList, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	isInferredType,
	isSchemaDefinition,
	matches,
	schemaCycleNames,
	schemaSchemaType,
	statementDeclaration,
	suspendedTypeName,
	typeAlias,
	variableFromScope
} from '#lib/ast.ts'

const EXPORT_PREFIXES: Record<string, string> = {ExportNamedDeclaration: 'export '}

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

// `typeof Note.Type` outside its pair repeats the derivation the alias names.
function queriedSchema(node: ESTree.TSTypeQuery) {
	if (
		node.exprName.type !== 'TSQualifiedName' ||
		node.exprName.left.type !== 'Identifier' ||
		node.exprName.right.name !== 'Type' ||
		!matches(/^[A-Z]/u)(node.exprName.left.name) ||
		(node.parent.type === 'TSTypeAliasDeclaration' && isInferredType({name: node.parent.id.name, node}))
	) {
		return Option.none()
	}
	return Option.some(node.exprName.left.name)
}

// The query's name reaches the module's own binding: no parameter, local or type parameter of that name sits in between.
function readsModuleBinding(context: Context, query: ESTree.TSTypeQuery, name: string) {
	return Option.exists(
		variableFromScope({name, scope: context.sourceCode.getScope(query)}),
		variable => variable.scope.block.type === 'Program'
	)
}

function reportSchemaVariable(input: {
	context: Context
	cycleNames: string[]
	program: ESTree.Program
	queries: ESTree.TSTypeQuery[]
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
			!Option.exists(
				namedTypeAlias({name, typeStatement}),
				declaration => !isInferredType({name, node: declaration.typeAnnotation})
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
		!Option.exists(namedTypeAlias({name, typeStatement}), declaration =>
			isInferredType({name, node: declaration.typeAnnotation})
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
				// The file's other `typeof Name.Type` queries read the new alias in the same edit, which the compiler's unnecessaryTypeofType would otherwise ask for by hand.
				return [
					fixer.insertTextBeforeRange(
						[start, start],
						`${EXPORT_PREFIXES[input.statement.type] ?? ''}type ${name} = typeof ${name}.Type\n`
					),
					...pipe(
						input.queries,
						Array.filter(
							query => Option.contains(queriedSchema(query), name) && readsModuleBinding(input.context, query, name)
						),
						Array.map(query => fixer.replaceText(query, name))
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
	create: context => {
		const queries = MutableList.make<ESTree.TSTypeQuery>()
		const seeds = MutableList.make<string>()
		return {
			CallExpression: node => {
				Option.map(suspendedTypeName({context, node}), name => MutableList.append(seeds, name))
			},
			'Program:exit': program => {
				const cycleNames = schemaCycleNames({context, program, seeds: MutableList.toArray(seeds)})
				const collected = MutableList.toArray(queries)
				for (const statement of program.body) {
					const declaration = statementDeclaration(statement)
					if (declaration?.type === 'VariableDeclaration') {
						for (const variable of declaration.declarations) {
							reportSchemaVariable({context, cycleNames, program, queries: collected, statement, variable})
						}
					}
				}
			},
			TSTypeQuery: node => {
				MutableList.append(queries, node)
			}
		}
	},
	meta: {fixable: 'code', type: 'problem'}
})
