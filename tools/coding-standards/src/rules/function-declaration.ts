import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {childNodes} from '#rules/shared.ts'

type Bound = ESTree.ArrowFunctionExpression | ESTree.Function

// What an arrow takes from its enclosing function, which a declaration would lose.
function lexical(context: Context, node: ESTree.Node): boolean {
	if (
		node.type === 'ThisExpression' ||
		node.type === 'Super' ||
		node.type === 'MetaProperty' ||
		(node.type === 'Identifier' && node.name === 'arguments')
	) {
		return true
	}
	if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration' || node.type === 'ClassBody') {
		return false
	}
	return Array.some(childNodes(context, node), child => lexical(context, child))
}

function placed(declaration: ESTree.VariableDeclaration) {
	return (
		declaration.parent.type === 'Program' ||
		declaration.parent.type === 'BlockStatement' ||
		declaration.parent.type === 'StaticBlock' ||
		declaration.parent.type === 'TSModuleBlock' ||
		(declaration.parent.type === 'ExportNamedDeclaration' && declaration.parent.declaration === declaration)
	)
}

function text(context: Context, node?: ESTree.Node | null) {
	if (Predicate.isNullish(node)) return ''
	return context.sourceCode.getText(node)
}

// The parameter list as written, wrapped in parentheses when a lone arrow parameter had none.
function parameters(context: Context, node: Bound) {
	return Option.match(Option.all([Array.head(node.params), Array.last(node.params)]), {
		onNone: () => '()',
		onSome: ends => {
			const open = context.sourceCode.getTokenBefore(ends[0])
			const close = context.sourceCode.getTokenAfter(ends[1], {filter: token => token.value === ')'})
			if (open?.value !== '(' || close === null) return `(${text(context, ends[0])})`
			return String.slice(open.range[0], close.range[1])(context.sourceCode.text)
		}
	})
}

function body(context: Context, node: Bound) {
	if (node.body?.type === 'BlockStatement') return text(context, node.body)
	return `{\nreturn ${text(context, node.body)}\n}`
}

function when(condition: boolean, value: string) {
	if (condition) return value
	return ''
}

// `const read = (path: string) => load(path)` becomes `function read(path: string) { return load(path) }`.
function fix(input: {
	context: Context
	declaration: ESTree.VariableDeclaration
	fixer: Fixer
	name: string
	node: Bound
}) {
	return input.fixer.replaceText(
		input.declaration,
		`${when(input.node.async, 'async ')}function${when(input.node.generator, '*')} ${input.name}${text(input.context, input.node.typeParameters)}${parameters(input.context, input.node)}${text(input.context, input.node.returnType)} ${body(input.context, input.node)}`
	)
}

export const functionDeclaration = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			const init = node.init
			if (init?.type !== 'ArrowFunctionExpression' && init?.type !== 'FunctionExpression') return
			if (init.type === 'ArrowFunctionExpression' && lexical(context, init.body)) return
			const declaration = node.parent
			context.report({
				fix: fixer => {
					if (
						declaration.type !== 'VariableDeclaration' ||
						declaration.kind !== 'const' ||
						declaration.declarations.length !== 1 ||
						declaration.declare === true ||
						!placed(declaration) ||
						node.id.type !== 'Identifier' ||
						Predicate.isNotNullish(node.id.typeAnnotation) ||
						(init.type === 'FunctionExpression' && Predicate.isNotNullish(init.id))
					) {
						return []
					}
					return fix({context, declaration, fixer, name: node.id.name, node: init})
				},
				message: 'Declare the function with a function declaration.',
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'suggestion'}
})
