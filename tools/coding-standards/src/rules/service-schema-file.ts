import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	importedMember,
	isImportBinding,
	isSchemaOperationName,
	isTestFile,
	matches,
	memberName,
	statementDeclaration
} from '#rules/shared.ts'

const SERVICE_PATH = /[/\\]src[/\\]services[/\\][^/\\]+[/\\]/u
const SCHEMA_FILE = /[/\\]schema\.ts$/u
const SCHEMA_CLASSES = ['Class', 'TaggedClass', 'TaggedError', 'TaggedRequest']
// A derivation such as `toEquivalence` or `isMinLength` reads a schema or builds a filter, but defines no schema of its own.
const DERIVED = matches(/^(?:is|to)[A-Z]/u)
const FILTER = matches(/^makeFilter(?:Group)?$/u)

// The Schema member a chain grows from: `Schema.Struct({}).check(...)` still defines Schema.Struct.
function schemaMember(input: {context: Context; node: ESTree.Expression}): Option.Option<ESTree.MemberExpression> {
	if (input.node.type === 'CallExpression' && input.node.callee.type !== 'Super') {
		return schemaMember({context: input.context, node: input.node.callee})
	}
	if (input.node.type === 'ChainExpression') return schemaMember({context: input.context, node: input.node.expression})
	if (input.node.type === 'TSInstantiationExpression') {
		return schemaMember({context: input.context, node: input.node.expression})
	}
	if (input.node.type === 'TSSatisfiesExpression') {
		return schemaMember({context: input.context, node: input.node.expression})
	}
	if (input.node.type === 'MemberExpression') {
		if (input.node.object.type === 'Identifier') return Option.some(input.node)
		if (input.node.object.type !== 'Super') return schemaMember({context: input.context, node: input.node.object})
	}
	return Option.none()
}

function constructorMember(input: {context: Context; node: ESTree.MemberExpression}) {
	return (
		importedMember({context: input.context, importedName: 'Schema', node: input.node}) &&
		pipe(
			memberName(input.node),
			Option.exists(name => !isSchemaOperationName(name) && !DERIVED(name) && !FILTER(name))
		)
	)
}

function definesSchema(input: {context: Context; node: ESTree.Expression}): boolean {
	if (
		input.node.type === 'CallExpression' &&
		input.node.callee.type === 'Identifier' &&
		isImportBinding({context: input.context, importedName: 'pipe', node: input.node.callee, source: 'effect'})
	) {
		const [first] = input.node.arguments
		return first !== undefined && first.type !== 'SpreadElement' && definesSchema({...input, node: first})
	}
	return pipe(
		schemaMember(input),
		Option.exists(member => constructorMember({context: input.context, node: member}))
	)
}

// `Schema.Class<Foo>()('Foo', {...})`, `Schema.TaggedError<Foo>()(...)` and any other call form start at the Schema member.
function schemaClass(input: {context: Context; node: ESTree.Expression}): boolean {
	if (input.node.type === 'CallExpression' && input.node.callee.type !== 'Super') {
		return schemaClass({context: input.context, node: input.node.callee})
	}
	if (input.node.type === 'TSInstantiationExpression') {
		return schemaClass({context: input.context, node: input.node.expression})
	}
	if (
		input.node.type === 'MemberExpression' &&
		input.node.object.type === 'Identifier' &&
		importedMember({context: input.context, importedName: 'Schema', node: input.node})
	) {
		return pipe(
			memberName(input.node),
			Option.exists(name => Array.contains(SCHEMA_CLASSES, name))
		)
	}
	return false
}

function extendsSchema(input: {context: Context; node: ESTree.Class}) {
	return input.node.superClass !== null && schemaClass({context: input.context, node: input.node.superClass})
}

function report(context: Context, node: ESTree.Node) {
	context.report({message: "Move this schema into the service's schema.ts and import it.", node})
}

// A default export can hold a class or an expression such as a class.
function exported(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	if (statement.type === 'ExportDefaultDeclaration') return statement.declaration
	return statementDeclaration(statement)
}

// The schema definitions one top-level declaration holds: a const's schema or schema class, or a schema class itself.
function definitions(context: Context, declaration: ReturnType<typeof exported>) {
	if (declaration?.type === 'VariableDeclaration' && declaration.kind === 'const') {
		return Array.flatMap(declaration.declarations, variable => {
			if (variable.init === null) return Array.empty<ESTree.Node>()
			if (variable.init.type === 'ClassExpression') {
				return Array.filter([variable.init], node => extendsSchema({context, node}))
			}
			return Array.filter([variable.init], node => definesSchema({context, node}))
		})
	}
	if (declaration?.type === 'ClassDeclaration' || declaration?.type === 'ClassExpression') {
		return Array.filter([declaration], node => extendsSchema({context, node}))
	}
	return Array.empty<ESTree.Node>()
}

export const serviceSchemaFile = defineRule({
	create: context => ({
		Program: program => {
			if (!SERVICE_PATH.test(context.filename) || SCHEMA_FILE.test(context.filename) || isTestFile(context)) return
			for (const node of Array.flatMap(program.body, statement => definitions(context, exported(statement)))) {
				report(context, node)
			}
		}
	}),
	meta: {type: 'problem'}
})
