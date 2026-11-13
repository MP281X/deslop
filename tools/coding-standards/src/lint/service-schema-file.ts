import {Array, Option, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isSchemaDefinition, isTestFile, matches, memberName, statementDeclaration} from '#lib/ast.ts'

const SERVICE_PATH = /[/\\]src[/\\]services[/\\][^/\\]+[/\\]/u
const SCHEMA_FILE = /[/\\]schema\.ts$/u
const SCHEMA_CLASSES = ['Class', 'TaggedClass', 'TaggedError', 'TaggedRequest']

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
		return Option.exists(memberName(input.node), name => Array.contains(SCHEMA_CLASSES, name))
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

function definitions(context: Context, declaration: ReturnType<typeof exported>) {
	if (declaration?.type === 'VariableDeclaration' && declaration.kind === 'const') {
		return Array.flatMap(declaration.declarations, variable => {
			if (variable.init === null) return Array.empty<ESTree.Node>()
			if (variable.init.type === 'ClassExpression') {
				return Array.filter([variable.init], node => extendsSchema({context, node}))
			}
			return Array.filter([variable.init], node => isSchemaDefinition({context, node}))
		})
	}
	if (declaration?.type === 'ClassDeclaration' || declaration?.type === 'ClassExpression') {
		return Array.filter([declaration], node => extendsSchema({context, node}))
	}
	return Array.empty<ESTree.Node>()
}

export const serviceSchemaFile = defineRule({
	create: context => ({
		ClassDeclaration: node => {
			if (!matches(/[/\\]src[/\\]services[/\\][^/\\]+[/\\]service\.ts$/u)(context.filename) || node.id === null) return
			function serviceBase(base: ESTree.Expression): boolean {
				if (base.type === 'CallExpression') return base.callee.type !== 'Super' && serviceBase(base.callee)
				return importedMember({context, importedName: 'Context', node: base, propertyName: 'Service'})
			}
			if (node.superClass === null || !serviceBase(node.superClass)) return
			const expected = pipe(
				String.split(context.filename, /[/\\]/u),
				Array.reverse,
				Array.getUnsafe(1),
				String.split('-'),
				Array.map(String.capitalize),
				Array.join('')
			)
			if (String.toLowerCase(node.id.name) !== String.toLowerCase(expected)) {
				context.report({
					message: `Name this service ${expected}, or give its folder the service's name.`,
					node: node.id
				})
			}
		},
		Program: program => {
			if (!SERVICE_PATH.test(context.filename) || SCHEMA_FILE.test(context.filename) || isTestFile(context)) return
			for (const node of Array.flatMap(program.body, statement => definitions(context, exported(statement)))) {
				report(context, node)
			}
		}
	}),
	meta: {type: 'problem'}
})
