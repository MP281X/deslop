import {Array, Equivalence, Function, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer, Variable} from 'vite-plus/lint/plugins'

import {matches, typeWrapped, variableFromScope} from '#rules/shared.ts'

const isConstantName = matches(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u)

// Literals, and arrays and objects built only from literals, hold no behavior and read the same everywhere.
function literal(node: ESTree.Node): boolean {
	if (node.type === 'Literal') return node.value !== null
	if (node.type === 'TemplateLiteral') return Array.isArrayEmpty(node.expressions)
	if (node.type === 'UnaryExpression') return node.operator === '-' && literal(node.argument)
	if (node.type === 'BinaryExpression') return literal(node.left) && literal(node.right)
	if (node.type === 'ArrayExpression') {
		return Array.every(
			node.elements,
			element => element !== null && element.type !== 'SpreadElement' && literal(element)
		)
	}
	if (node.type === 'ObjectExpression') {
		return Array.every(
			node.properties,
			property =>
				property.type === 'Property' && !property.computed && property.kind === 'init' && literal(property.value)
		)
	}
	return pipe(typeWrapped(node), Option.exists(literal))
}

function literalConstant(statement: ESTree.Statement | ESTree.ModuleDeclaration) {
	if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const' || statement.declarations.length !== 1) {
		return Option.none()
	}
	const [node] = statement.declarations
	if (node?.id.type !== 'Identifier' || node.init === null || !literal(node.init)) return Option.none()
	return Option.some({id: node.id, node})
}

// A shorthand property keeps its key: `{hosts}` becomes `{hosts: HOSTS}`.
function renamed(input: {fixer: Fixer; name: string; reference: Variable['references'][number]}) {
	if (input.reference.identifier.parent.type === 'Property' && input.reference.identifier.parent.shorthand) {
		return input.fixer.replaceText(input.reference.identifier, `${input.reference.identifier.name}: ${input.name}`)
	}
	return input.fixer.replaceText(input.reference.identifier, input.name)
}

function primitive(node: ESTree.Node): boolean {
	if (node.type === 'Literal') return !Predicate.hasProperty(node, 'regex')
	return (
		Array.contains(['BinaryExpression', 'TemplateLiteral', 'UnaryExpression'], node.type) ||
		pipe(typeWrapped(node), Option.exists(primitive))
	)
}

function check(input: {
	context: Context
	found: {id: ESTree.BindingIdentifier; node: ESTree.VariableDeclarator}
	leading: boolean
	variable: Variable
}) {
	// A one-line primitive read once reads best in place; a longer one keeps a name, an annotated one keeps its type, and an array, object or regex keeps the one instance its callers share.
	if (
		input.found.id.typeAnnotation === null &&
		input.found.node.init !== null &&
		primitive(input.found.node.init) &&
		Array.countBy(input.variable.references, reference => reference.isRead()) === 1 &&
		!pipe(input.context.sourceCode.getText(input.found.node), String.includes('\n'))
	) {
		input.context.report({message: 'Inline this value at its only use.', node: input.found.node})
		return
	}
	if (!isConstantName(input.found.id.name)) {
		const name = pipe(input.found.id.name, String.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/gu, '_'), String.toUpperCase)
		// The new name must not resolve to another binding at the declaration or at any read.
		const taken = Array.some(
			[input.found.id, ...Array.map(input.variable.references, reference => reference.identifier)],
			node => Option.isSome(variableFromScope({name, scope: input.context.sourceCode.getScope(node)}))
		)
		input.context.report({
			fix: fixer => {
				if (taken) return []
				return [
					// The binding's range covers its type annotation, which stays.
					fixer.replaceTextRange([input.found.id.range[0], input.found.id.range[0] + input.found.id.name.length], name),
					...pipe(
						input.variable.references,
						Array.filter(reference => reference.identifier !== input.found.id),
						Array.map(reference => renamed({fixer, name, reference}))
					)
				]
			},
			message: `Name this module constant ${name}.`,
			node: input.found.node
		})
	}
	if (!input.leading) {
		input.context.report({message: 'Declare this module constant directly under the imports.', node: input.found.node})
	}
}

export const moduleConstant = defineRule({
	create: context => ({
		Program: program => {
			const leading = Array.takeWhile(
				program.body,
				statement => statement.type === 'ImportDeclaration' || Option.isSome(literalConstant(statement))
			)
			for (const statement of program.body) {
				pipe(
					literalConstant(statement),
					Option.flatMap(found =>
						pipe(
							variableFromScope({name: found.id.name, scope: context.sourceCode.getScope(found.node)}),
							// An exported value is read by other modules too.
							Option.filter(
								variable =>
									!Array.some(variable.references, reference => reference.identifier.parent.type === 'ExportSpecifier')
							),
							Option.map(variable => ({found, variable}))
						)
					),
					Option.match({
						onNone: Function.constVoid,
						onSome: match =>
							check({
								...match,
								context,
								leading: Array.containsWith(Equivalence.strictEqual<ESTree.Statement | ESTree.ModuleDeclaration>())(
									leading,
									statement
								)
							})
					})
				)
			}
		}
	}),
	meta: {fixable: 'code', type: 'suggestion'}
})
