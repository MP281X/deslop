import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, returnedExpression} from '#rules/shared.ts'

const MESSAGE =
	'Pass the generator to Effect.fnUntraced(function* (input) { … }) instead of a callback that returns Effect.gen, or Effect.fn("Name")(function* …) for a traced span.'

type Callback = ESTree.ArrowFunctionExpression | ESTree.Function

// The Effect compiler's effectFnOpportunity owns functions with a name: declarations, variables and object or class properties.
function named(node: Callback) {
	if (node.parent.type === 'VariableDeclarator') return node.parent.init === node
	if (node.parent.type === 'PropertyDefinition') return node.parent.value === node
	return (
		node.parent.type === 'Property' &&
		node.parent.value === node &&
		!node.parent.computed &&
		(node.parent.key.type === 'Identifier' ||
			(node.parent.key.type === 'Literal' && Predicate.isString(node.parent.key.value)))
	)
}

// `Effect.gen(function* () {…})` with no `this` binding and an anonymous generator that takes nothing.
function generator(context: Context, node: ReturnType<typeof returnedExpression>) {
	if (
		Predicate.isNullish(node) ||
		node.type !== 'CallExpression' ||
		node.callee.type !== 'MemberExpression' ||
		!importedMember({context, importedName: 'Effect', node: node.callee, propertyName: 'gen'}) ||
		node.arguments.length !== 1
	) {
		return Option.none()
	}
	const effect = node.callee.object
	return pipe(
		Array.head(node.arguments),
		Option.filter(
			(argument): argument is ESTree.Function & {body: ESTree.FunctionBody} =>
				argument.type === 'FunctionExpression' &&
				argument.generator &&
				!argument.async &&
				argument.id === null &&
				Array.isArrayEmpty(argument.params) &&
				argument.body !== null &&
				// Effect.gen calls its generator with nothing, while the wrapper passes its own arguments and receiver on.
				Option.isNone(String.match(/\b(?:arguments|this)\b/u)(context.sourceCode.getText(argument.body)))
		),
		Option.map(body => ({body, effect}))
	)
}

function check(context: Context, node: Callback) {
	if (node.async || node.generator || node.returnType !== null || named(node)) return
	if (node.type === 'FunctionExpression' && node.id !== null) return
	// A parameter typed by its call site, such as `HttpClient.make(request => …)`, loses that type inside the generic wrapper.
	if (
		!Array.every(
			node.params,
			parameter => parameter.type === 'Identifier' && Predicate.isNotNullish(parameter.typeAnnotation)
		)
	) {
		return
	}
	Option.match(generator(context, returnedExpression(node)), {
		onNone: () => undefined,
		onSome: found => {
			const parameters = Option.match(Array.head(node.params), {
				onNone: () => '',
				onSome: first =>
					String.slice(
						first.range[0],
						Option.getOrElse(Array.last(node.params), () => first).range[1]
					)(context.sourceCode.text)
			})
			const typeParameters = Option.match(Option.fromNullishOr(node.typeParameters), {
				onNone: () => '',
				onSome: declared => context.sourceCode.getText(declared)
			})
			context.report({
				fix: fixer =>
					fixer.replaceTextRange(
						node.range,
						`${context.sourceCode.getText(found.effect)}.fnUntraced(function* ${typeParameters}(${parameters}) ${context.sourceCode.getText(found.body.body)})`
					),
				message: MESSAGE,
				node
			})
		}
	})
}

export const noEffectGenCallback = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => check(context, node),
		FunctionExpression: node => check(context, node)
	}),
	meta: {fixable: 'code', type: 'problem'}
})
