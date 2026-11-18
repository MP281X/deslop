import {Array, Boolean, Function, MutableList, Option, Predicate, pipe} from 'effect'

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

function reportPairExports(
	context: Context,
	statement: ESTree.Statement,
	type: ESTree.Statement | ESTree.ModuleDeclaration
) {
	if (type.type !== 'TSTypeAliasDeclaration' && statement.type !== 'VariableDeclaration') return
	context.report({
		fix: fixer =>
			pipe(
				[type, statement],
				Array.filter(
					node =>
						node.type === 'TSTypeAliasDeclaration' ||
						(node.type === 'VariableDeclaration' && node.declarations.length === 1)
				),
				Array.map(node => fixer.insertTextBefore(node, 'export '))
			),
		message: 'Export the Schema and its type together from schema.ts',
		node: statement
	})
}

function reportSchemaAnnotations(context: Context, id: ESTree.BindingIdentifier, init: ESTree.Expression) {
	if (init.type === 'TSSatisfiesExpression' && schemaSchemaType({context, node: init.typeAnnotation})) {
		context.report({message: 'Infer this schema instead of restating Schema.Schema.', node: init})
	}
	if (
		Predicate.isNotNullish(id.typeAnnotation) &&
		schemaSchemaType({context, node: id.typeAnnotation.typeAnnotation})
	) {
		context.report({message: 'Infer this schema instead of annotating Schema.Schema.', node: id})
	}
}

function reportSchemaVariable(input: {
	context: Context
	cycleNames: string[]
	program: ESTree.Program
	queries: ESTree.TSTypeQuery[]
	statement: ESTree.Statement
	variable: ESTree.VariableDeclarator
}) {
	if (input.variable.id.type !== 'Identifier') return
	if (input.variable.init === null) return
	const name = input.variable.id.name
	if (!matches(/^[A-Z]/u)(name)) {
		return
	}

	const typeStatement = pipe(
		input.program.body,
		Array.findFirstIndex(statement => statement === input.statement),
		Option.filter(index => index > 0),
		Option.flatMap(index => Array.get(input.program.body, index - 1))
	)
	const schemaFile = matches(/(?:^|[/\\])schema\.ts$/u)(input.context.filename)
	const alias = namedTypeAlias({name, typeStatement})
	const inferred = Option.exists(alias, declaration => isInferredType({name, node: declaration.typeAnnotation}))
	const schema = isSchemaDefinition({context: input.context, node: input.variable.init})
	if (schemaFile && Option.isSome(alias) && (schema || inferred)) {
		Option.map(typeStatement, type => reportPairExports(input.context, input.statement, type))
	}
	if (!schema) return
	if (Array.contains(input.cycleNames, name)) {
		if (!Option.exists(alias, declaration => !isInferredType({name, node: declaration.typeAnnotation}))) {
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
	if (!inferred) {
		input.context.report({
			fix: fixer => {
				if (!pairable({...input, name})) return []
				const start = pipe(
					input.context.sourceCode.getCommentsBefore(input.statement),
					Array.head,
					Option.getOrElse(() => input.statement)
				).range[0]
				const prefix = Boolean.match(schemaFile, {
					onFalse: () => EXPORT_PREFIXES[input.statement.type] ?? '',
					onTrue: Function.constant('export ')
				})
				// The file's other `typeof Name.Type` queries read the new alias in the same edit, which the compiler's unnecessaryTypeofType would otherwise ask for by hand.
				return [
					fixer.insertTextBeforeRange([start, start], `${prefix}type ${name} = typeof ${name}.Type\n`),
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
	reportSchemaAnnotations(input.context, input.variable.id, input.variable.init)
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
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'src/services/notes/schema.ts': `import {Schema} from 'effect'
export type Note = typeof Note.Type
export const Note = Schema.Struct({title: Schema.String})`
					},
					{
						'sample.ts': `import {Schema} from 'effect'
export type Note = typeof Note.Type
export const Note = Schema.Struct({title: Schema.String})
export function titleOf(note: Note) { return note.title }`
					}
				],
				fixes: [
					{
						'src/services/notes/schema.ts': `import {Schema} from 'effect'
export type Note = typeof Note.Type
const Note = Schema.Struct({title: Schema.String})`
					},
					{
						'sample.ts': `import {Schema} from 'effect'
export const Note = Schema.Struct({title: Schema.String})
export function titleOf(note: typeof Note.Type) { return note.title }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
