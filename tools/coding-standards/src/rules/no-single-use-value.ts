import {Array, MutableRef, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {variableFromScope} from '#rules/shared.ts'

const repeating = [
	'ArrowFunctionExpression',
	'DoWhileStatement',
	'ForInStatement',
	'ForOfStatement',
	'ForStatement',
	'FunctionDeclaration',
	'FunctionExpression',
	'WhileStatement'
]

// True when the read runs exactly once whenever the statement runs: not repeated by a loop or callback, and not
// skipped by a conditional, short-circuit or optional chain.
function runsOnce(input: {child: ESTree.Node; node: ESTree.Node; statement: ESTree.Node}): boolean {
	const node = input.node
	const child = input.child
	if (
		((node.type === 'ForOfStatement' || node.type === 'ForInStatement') && node.right === child) ||
		(node.type === 'IfStatement' && node.test === child) ||
		(node.type === 'ConditionalExpression' && node.test === child) ||
		(node.type === 'LogicalExpression' && node.left === child)
	) {
		return climb({...input, node})
	}
	if (
		Array.contains(repeating, node.type) ||
		node.type === 'IfStatement' ||
		node.type === 'ConditionalExpression' ||
		node.type === 'LogicalExpression' ||
		node.type === 'ChainExpression' ||
		node.type === 'SwitchStatement' ||
		node.type === 'TryStatement'
	) {
		return false
	}
	return climb({...input, node})
}

function climb(input: {node: ESTree.Node; statement: ESTree.Node}) {
	if (input.node === input.statement) return true
	if (Predicate.isNullish(input.node.parent)) return false
	return runsOnce({child: input.node, node: input.node.parent, statement: input.statement})
}

function insideConditional(input: {node: ESTree.Node; statement: ESTree.Node}): boolean {
	if (input.node === input.statement) return false
	if (input.node.type === 'ConditionalExpression') return true
	return Predicate.isNotNullish(input.node.parent) && insideConditional({...input, node: input.node.parent})
}

function candidate(node: ESTree.VariableDeclarator) {
	const declaration = node.parent
	const init = node.init
	return (
		declaration.type === 'VariableDeclaration' &&
		declaration.kind === 'const' &&
		declaration.declarations.length === 1 &&
		declaration.parent.type === 'BlockStatement' &&
		node.id.type === 'Identifier' &&
		node.id.typeAnnotation === null &&
		init !== null &&
		// Functions belong to the indirection check and plain literals to the literal check.
		!Array.contains(['ArrowFunctionExpression', 'FunctionExpression'], init.type) &&
		!(init.type === 'Literal' && !Predicate.hasProperty(init, 'regex')) &&
		!(init.type === 'TemplateLiteral' && Array.isArrayEmpty(init.expressions))
	)
}

function report(input: {context: Context; effects: ESTree.Node[]; node: ESTree.VariableDeclarator}) {
	const declaration = input.node.parent
	const init = input.node.init
	if (
		declaration.type !== 'VariableDeclaration' ||
		declaration.parent.type !== 'BlockStatement' ||
		input.node.id.type !== 'Identifier' ||
		init === null ||
		pipe(input.context.sourceCode.getText(init), String.includes('\n'))
	) {
		return
	}
	const statements = declaration.parent.body
	const name = input.node.id.name
	pipe(
		Array.findFirstIndex(statements, statement => statement === declaration),
		Option.flatMap(index => Array.get(statements, index + 1)),
		Option.flatMap(next =>
			pipe(
				variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)}),
				Option.map(variable => Array.filter(variable.references, reference => reference.isRead())),
				Option.filter(reads => reads.length === 1),
				Option.flatMap(Array.head),
				Option.map(reference => reference.identifier),
				Option.filter(
					read =>
						read.range[0] >= next.range[0] &&
						read.range[1] <= next.range[1] &&
						climb({node: read, statement: next}) &&
						// Inlining a conditional value into another conditional would nest ternaries, which lint forbids.
						!(init.type === 'ConditionalExpression' && insideConditional({node: read, statement: next})) &&
						// Moving the value past code that runs first would change what it reads or reorder effects.
						!Array.some(input.effects, effect => effect.range[0] >= next.range[0] && effect.range[1] <= read.range[0])
				)
			)
		),
		Option.map(() => {
			input.context.report({message: 'Inline this value into the next statement, its only use.', node: input.node})
		})
	)
}

export const noSingleUseValue = defineRule({
	create: context => {
		const effects = MutableRef.make(Array.empty<ESTree.Node>())
		const candidates = MutableRef.make(Array.empty<ESTree.VariableDeclarator>())
		function effect(node: ESTree.Node) {
			MutableRef.update(effects, Array.append(node))
		}
		return {
			AssignmentExpression: effect,
			AwaitExpression: effect,
			CallExpression: effect,
			NewExpression: effect,
			'Program:exit': () => {
				for (const node of MutableRef.get(candidates)) report({context, effects: MutableRef.get(effects), node})
			},
			TaggedTemplateExpression: effect,
			UpdateExpression: effect,
			VariableDeclarator: node => {
				if (candidate(node)) MutableRef.update(candidates, Array.append(node))
			},
			YieldExpression: effect
		}
	},
	meta: {type: 'problem'}
})
