import {
	Array,
	Boolean,
	Cause,
	Chunk,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	Exit,
	Fiber,
	Function,
	HashMap,
	HashSet,
	Layer,
	Match,
	MutableList,
	MutableRef,
	Number,
	Option,
	Order,
	Predicate,
	Queue,
	Record,
	Result,
	Ref,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import {Command} from 'effect/cli'
import {HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Atom, AtomRegistry, AsyncResult, Reactivity} from 'effect/reactivity'
import {defineRule} from 'vite-plus/lint/plugins'
// oxlint-disable-next-line @deslop/coding-standards/no-renamed-import -- Effect's Context module and the linter's Context type are distinct contracts.
import type {Context as LintContext, ESTree} from 'vite-plus/lint/plugins'

import {effectImport, importedMember, isImportBinding, matches, memberName, variableFromScope} from '#lib/ast.ts'

const MODULES: Record.ReadonlyRecord<string, Record.ReadonlyRecord<string, unknown>> = {
	Array,
	AsyncResult,
	Atom,
	AtomRegistry,
	Boolean,
	Cause,
	Chunk,
	Command,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	Exit,
	Fiber,
	Function,
	HashMap,
	HashSet,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerResponse,
	Layer,
	Match,
	MutableList,
	MutableRef,
	Number,
	Option,
	Order,
	Predicate,
	Queue,
	Reactivity,
	Record,
	Ref,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	SubscriptionRef
}

function moduleSource(name: string) {
	if (name === 'Command') return 'effect/cli'
	if (Array.contains(['Atom', 'AtomRegistry', 'AsyncResult', 'Reactivity'], name)) return 'effect/reactivity'
	if (
		Array.contains(['HttpClient', 'HttpClientRequest', 'HttpClientResponse', 'HttpRouter', 'HttpServerResponse'], name)
	) {
		return 'effect/http'
	}
	return 'effect'
}

// Function.dual's installed implementation dispatches on arguments; curried-only functions do not.
const DUALS = new WeakMap<object, boolean>()

// Layer constructors curry the service tag, not the data; their direct overload keeps that tag first.
function tagFirst(node: ESTree.Node) {
	if (node.type !== 'MemberExpression' || node.object.type !== 'Identifier') return false
	if (node.object.name === 'Layer') {
		return Option.exists(memberName(node), name => Array.contains(['effect', 'succeed', 'sync'], name))
	}
	return (
		node.object.name === 'Semaphore' &&
		Option.exists(memberName(node), name =>
			Array.contains(['withPermit', 'withPermits', 'withPermitsIfAvailable'], name)
		)
	)
}

// SqlClient installs this readonly function without a receiver; arbitrary object methods keep theirs.
function transaction(context: LintContext, node: ESTree.Node) {
	if (
		node.type !== 'MemberExpression' ||
		node.object.type !== 'Identifier' ||
		!Option.contains(memberName(node), 'withTransaction')
	) {
		return false
	}
	return Option.exists(
		variableFromScope({name: node.object.name, scope: context.sourceCode.getScope(node)}),
		variable =>
			Array.some(variable.defs, definition => {
				if (definition.node.type !== 'VariableDeclarator' || definition.node.init?.type !== 'YieldExpression') {
					return false
				}

				return (
					definition.node.init.argument?.type === 'MemberExpression' &&
					definition.node.init.argument.object.type === 'Identifier' &&
					Option.contains(memberName(definition.node.init.argument), 'SqlClient') &&
					isImportBinding({
						context,
						importedName: 'SqlClient',
						node: definition.node.init.argument.object,
						source: 'effect/sql'
					})
				)
			})
	)
}

function dual(context: LintContext, node: ESTree.Node) {
	if (node.type !== 'MemberExpression' || node.computed || node.object.type !== 'Identifier') return Option.none()
	const module = node.object.name
	if (!isImportBinding({context, importedName: module, node: node.object, source: moduleSource(module)})) {
		return Option.none()
	}
	return pipe(
		memberName(node),
		Option.flatMap(name => Option.fromNullishOr(MODULES[module]?.[name])),
		Option.filter(Predicate.isFunction),
		Option.filter(fn => {
			const cached = DUALS.get(fn)
			if (cached !== undefined) return cached
			const result =
				fn === Effect.provideService ||
				fn === Equal.equals ||
				tagFirst(node) ||
				matches(/return function \(self\)|return arity\(arguments\) \? body\.apply/u)(fn.toString())
			DUALS.set(fn, result)
			return result
		})
	)
}

// Only immutable reads and inert construction may move across a step; other arguments keep their evaluation order.
function stableConstructor(context: LintContext, node: ESTree.CallExpression) {
	return (
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier' &&
		Array.contains(
			[
				'Array.empty',
				'Effect.succeed',
				'Effect.gen',
				'Effect.fn',
				'Effect.fnUntraced',
				'Effect.andThen',
				'Effect.forEach',
				'Effect.ignore',
				'Order.mapInput',
				'Order.flip',
				'Order.combine',
				'Schema.is',
				'Command.make',
				'Command.withSubcommands',
				'Command.withSharedFlags',
				'Schema.withDecodingDefaultTypeKey',
				'Schema.withDecodingDefaultKey'
			],
			`${node.callee.object.name}.${Option.getOrElse(memberName(node.callee), () => '')}`
		) &&
		isImportBinding({
			context,
			importedName: node.callee.object.name,
			node: node.callee.object,
			source: moduleSource(node.callee.object.name)
		})
	)
}

function stable(context: LintContext, node: ESTree.Node): boolean {
	if (
		node.type === 'TSAsExpression' ||
		node.type === 'TSSatisfiesExpression' ||
		node.type === 'TSInstantiationExpression'
	) {
		return stable(context, node.expression)
	}
	if (node.type === 'TemplateLiteral') return Array.every(node.expressions, expression => stable(context, expression))
	if (node.type === 'CallExpression') {
		return (
			(stableConstructor(context, node) ||
				Option.exists(dual(context, node.callee), fn => Number.max(fn.length, 2) > node.arguments.length)) &&
			Array.every(node.arguments, arg => stable(context, arg))
		)
	}

	if (node.type === 'ArrayExpression') {
		return Array.every(node.elements, element => element === null || stable(context, element))
	}
	if (node.type === 'ObjectExpression') {
		return Array.every(
			node.properties,
			property => property.type === 'Property' && !property.computed && stable(context, property.value)
		)
	}
	if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && !node.computed) {
		return (
			transaction(context, node) ||
			isImportBinding({context, importedName: node.object.name, node: node.object, source: /^effect(?:\/|$)/u})
		)
	}
	if (
		node.type === 'ThisExpression' ||
		node.type === 'Literal' ||
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionExpression'
	) {
		return true
	}
	if (node.type !== 'Identifier') return false
	return Option.exists(
		variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}),
		variable =>
			Array.every(variable.references, reference => !reference.isWrite() || reference.init) &&
			Array.some(
				variable.defs,
				definition =>
					definition.type === 'ImportBinding' ||
					definition.type === 'Parameter' ||
					definition.type === 'ClassName' ||
					definition.type === 'FunctionName' ||
					(definition.node.type === 'VariableDeclarator' &&
						definition.node.parent.type === 'VariableDeclaration' &&
						definition.node.parent.kind === 'const')
			)
	)
}

function dataFirst(context: LintContext, node: ESTree.Node) {
	return (
		node.type === 'CallExpression' &&
		!node.optional &&
		!tagFirst(node.callee) &&
		!Array.some(node.arguments, argument => argument.type === 'SpreadElement') &&
		Option.exists(dual(context, node.callee), fn => node.arguments.length >= Number.max(fn.length, 2))
	)
}

function directArguments(callee: ESTree.Node, subjects: ESTree.Node[], args: ESTree.Node[]) {
	if (tagFirst(callee)) return [...args, ...subjects]
	return [...subjects, ...args]
}

function text(context: LintContext, node: ESTree.Node) {
	return context.sourceCode.getText(node)
}

function typeArguments(context: LintContext, node: ESTree.CallExpression) {
	if (Predicate.isNullish(node.typeArguments)) return ''
	return text(context, node.typeArguments)
}

function argumentsText(context: LintContext, args: ESTree.Node[]) {
	return pipe(
		args,
		Array.map(arg => text(context, arg)),
		Array.join(', ')
	)
}

function schemaOperation(
	context: LintContext,
	node: ESTree.Node,
	names: readonly string[]
): node is ESTree.MemberExpression {
	return (
		node.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Schema', node}) &&
		Option.exists(memberName(node), name => Array.contains(names, name))
	)
}

function schemaType(context: LintContext, node: ESTree.Node): Option.Option<string> {
	if (
		node.type === 'CallExpression' &&
		schemaOperation(context, node.callee, ['Literals']) &&
		node.arguments[0]?.type === 'ArrayExpression'
	) {
		return Option.some(`Schema.Literals<readonly ${text(context, node.arguments[0])}>`)
	}
	if (node.type === 'Identifier' || node.type === 'MemberExpression') {
		return Option.some(`typeof ${text(context, node)}`)
	}
	if (
		node.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		Option.exists(memberName(node.callee), name => Array.contains(['check', 'annotate'], name))
	) {
		return schemaType(context, node.callee.object)
	}
	return Option.none()
}

function chain(context: LintContext, node: ESTree.Node): Option.Option<{subject: ESTree.Node; steps: string[]}> {
	if (node.type !== 'CallExpression' || !dataFirst(context, node)) return Option.some({steps: [], subject: node})
	const [subject, ...args] = node.arguments
	if (subject === undefined || !Array.every(args, arg => stable(context, arg))) return Option.none()
	return Option.map(chain(context, subject), inner => ({
		steps: [
			...inner.steps,
			`${text(context, node.callee)}${typeArguments(context, node)}(${argumentsText(context, args)})`
		],
		subject: inner.subject
	}))
}

// Only a sole read in the first argument is forwarding; a closure that also uses its subject is real work.
function forwardedBody(context: LintContext, node: ESTree.Node) {
	if (node.type !== 'ArrowFunctionExpression' || node.async || node.params.length !== 1) return Option.none()
	const parameter = node.params[0]
	const body = node.body
	if (parameter?.type !== 'Identifier' || body.type !== 'CallExpression') {
		return Option.none()
	}
	const first = body.arguments[0]
	if (first?.type !== 'Identifier' || first.name !== parameter.name) return Option.none()
	return pipe(
		variableFromScope({name: parameter.name, scope: context.sourceCode.getScope(body)}),
		Option.filter(variable => Array.countBy(variable.references, reference => reference.isRead()) === 1),
		Option.map(() => body)
	)
}

function forwarding(context: LintContext, node: ESTree.Node) {
	return Option.filter(forwardedBody(context, node), body => dataFirst(context, body))
}

function plainForwarding(context: LintContext, node: ESTree.Node) {
	return Option.filter(forwardedBody(context, node), body => stable(context, body.callee))
}

function forwardCall(context: LintContext, call: ESTree.CallExpression, subject: string) {
	return `${text(context, call.callee)}${typeArguments(context, call)}(${subject}, ${argumentsText(context, Array.drop(call.arguments, 1))})`
}

function pipelineText(subject: string, steps: string[]) {
	if (Array.isArrayEmpty(steps)) return subject
	return `pipe(${subject}, ${Array.join(steps, ', ')})`
}

function normalizeForwarding(context: LintContext, node: ESTree.CallExpression) {
	if (node.arguments.length !== 1 || node.arguments[0]?.type === 'SpreadElement') return
	const subject = node.arguments[0]
	if (subject === undefined) return
	Option.match(plainForwarding(context, node.callee), {
		onNone: () => {},
		onSome: call =>
			context.report({
				fix: fixer => fixer.replaceText(node, forwardCall(context, call, text(context, subject))),
				message: 'Call the operation directly instead of immediately applying a forwarding arrow.',
				node
			})
	})
}

function normalizeCallee(context: LintContext, node: ESTree.CallExpression) {
	if (node.callee.type === 'ParenthesizedExpression' && node.callee.expression.type === 'CallExpression') {
		const call = node.callee.expression
		if (
			Option.isSome(dual(context, call.callee)) ||
			(call.callee.type === 'MemberExpression' &&
				call.callee.object.type === 'Identifier' &&
				call.callee.object.name === 'Schema')
		) {
			const callee = node.callee
			context.report({
				fix: fixer => fixer.replaceText(callee, text(context, call)),
				message: 'Use the plain call form so its subject and type stay visible.',
				node
			})
		}
	}
}

function normalizeSchema(context: LintContext, node: ESTree.CallExpression) {
	if (
		node.callee.type === 'CallExpression' &&
		Predicate.isNullish(node.callee.typeArguments) &&
		schemaOperation(context, node.callee.callee, ['withDecodingDefaultKey', 'withDecodingDefaultTypeKey']) &&
		node.arguments.length === 1 &&
		node.arguments[0] !== undefined &&
		Option.isSome(schemaType(context, node.arguments[0]))
	) {
		const subject = node.arguments[0]
		const callee = node.callee.callee
		context.report({
			fix: fixer =>
				Option.toArray(Option.map(schemaType(context, subject), type => fixer.insertTextAfter(callee, `<${type}>`))),
			message: 'Keep the schema subject in the type of a curried-only schema operation.',
			node
		})
	}
	if (
		node.callee.type === 'CallExpression' &&
		schemaOperation(context, node.callee.callee, ['check', 'annotate']) &&
		node.arguments.length === 1
	) {
		const subject = node.arguments[0]
		const curried = node.callee
		const method = node.callee.callee.property
		if (subject === undefined || subject.type === 'SpreadElement') return
		context.report({
			fix: fixer =>
				fixer.replaceText(
					node,
					`(${text(context, subject)}).${text(context, method)}(${argumentsText(context, curried.arguments)})`
				),
			message: 'Refine and annotate a schema through its methods so the subject determines its type.',
			node
		})
	}
}

function normalizeBoundary(context: LintContext, node: ESTree.CallExpression) {
	const boundary = Option.getOrUndefined(
		pipe(
			node.arguments,
			Array.drop(1),
			Array.findFirst((step, index) =>
				pipe(
					forwardedBody(context, step),
					Option.filter(
						body =>
							body.callee.type === 'Identifier' &&
							isImportBinding({context, importedName: 'pipe', node: body.callee, source: 'effect'})
					),
					Option.map(body => ({body, index}))
				)
			)
		)
	)
	if (boundary !== undefined) {
		const before = Array.take(node.arguments, boundary.index + 1)
		const inner = Array.drop(boundary.body.arguments, 1)
		const after = Array.drop(node.arguments, boundary.index + 2)
		if (!Array.every(after, argument => stable(context, argument))) return false
		context.report({
			fix: fixer => {
				if (Array.every(inner, argument => stable(context, argument))) {
					return fixer.replaceText(node, `pipe(${argumentsText(context, [...before, ...inner, ...after])})`)
				}
				return fixer.replaceText(
					node,
					`pipe(pipe(${argumentsText(context, before)}), ${argumentsText(context, [...inner, ...after])})`
				)
			},
			message: 'Keep pipeline steps as operations, not an arrow that applies another pipeline.',
			node
		})
		return true
	}
	return false
}

function preservesOrder(context: LintContext, subject: ESTree.Node, args: ESTree.Node[]) {
	return stable(context, subject) || Array.every(args, argument => stable(context, argument))
}

function normalizeSingleStep(context: LintContext, node: ESTree.CallExpression) {
	if (node.arguments.length !== 2) return

	const [subject, step] = node.arguments
	if (
		subject === undefined ||
		step === undefined ||
		subject.type === 'SpreadElement' ||
		step.type === 'SpreadElement'
	) {
		return
	}
	const plain = Option.getOrUndefined(plainForwarding(context, step))
	if (plain !== undefined) {
		context.report({
			fix: fixer => fixer.replaceText(node, forwardCall(context, plain, text(context, subject))),
			message: 'Call the operation directly instead of forwarding a pipeline subject.',
			node
		})
		return
	}
	// A real closure has no equivalent plain call; never manufacture an immediately-applied arrow.
	if (step.type === 'ArrowFunctionExpression') return
	context.report({
		fix: fixer => {
			if (step.type === 'CallExpression' && schemaOperation(context, step.callee, ['check', 'annotate'])) {
				return fixer.replaceText(
					node,
					`(${text(context, subject)}).${text(context, step.callee.property)}(${argumentsText(context, step.arguments)})`
				)
			}
			if (step.type === 'CallExpression' && Option.isSome(dual(context, step.callee))) {
				if (Array.some(step.arguments, arg => arg.type === 'SpreadElement')) return []
				if (tagFirst(step.callee) && !preservesOrder(context, subject, step.arguments)) {
					return []
				}
				return fixer.replaceText(
					node,
					`${text(context, step.callee)}${typeArguments(context, step)}(${argumentsText(context, directArguments(step.callee, [subject], step.arguments))})`
				)
			}
			if (step.type !== 'Identifier' && step.type !== 'CallExpression' && !stable(context, step)) {
				return []
			}
			if (step.type === 'CallExpression' && !preservesOrder(context, subject, step.arguments)) {
				return []
			}
			return fixer.replaceText(node, `${text(context, step)}(${text(context, subject)})`)
		},
		message: 'One step is a plain call; reserve pipe for two or more steps.',
		node
	})
}

function normalizePipe(context: LintContext, node: ESTree.CallExpression) {
	if (
		node.callee.type !== 'Identifier' ||
		!isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})
	) {
		return
	}
	if (normalizeBoundary(context, node)) return
	const first = node.arguments[0]
	if (
		first?.type === 'CallExpression' &&
		first.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: first.callee, source: 'effect'})
	) {
		const steps = Array.drop(node.arguments, 1)
		// Flattening otherwise evaluates a step's arguments before the inner pipe has run.
		if (!Array.every(steps, step => stable(context, step))) return
		context.report({
			fix: fixer => fixer.replaceText(node, `pipe(${argumentsText(context, [...first.arguments, ...steps])})`),
			message: 'Keep consecutive steps in one standalone pipe.',
			node
		})
		return
	}
	const steps = Array.drop(node.arguments, 1)
	const forwarded = Array.map(steps, step => forwarding(context, step))
	if (Array.some(forwarded, Option.isSome)) {
		context.report({
			fix: fixer => {
				if (first === undefined || first.type === 'SpreadElement') return []
				const safe = Array.every(forwarded, call =>
					Option.match(call, {
						onNone: () => true,
						onSome: operation =>
							pipe(
								operation.arguments,
								Array.drop(1),
								Array.every(arg => stable(context, arg))
							)
					})
				)
				if (safe && node.arguments.length > 2) {
					return Array.flatMap(steps, (step, index) =>
						Option.toArray(
							Option.map(forwarded[index] ?? Option.none(), call =>
								fixer.replaceText(
									step,
									`${text(context, call.callee)}${typeArguments(context, call)}(${argumentsText(context, Array.drop(call.arguments, 1))})`
								)
							)
						)
					)
				}
				// Restore direct calls at unstable steps. Earlier closures remain ordinary pipeline steps, never applied arrows.
				if (!Array.every(steps, step => Option.isSome(forwarding(context, step)) || stable(context, step))) return []
				const direct = Array.reduce(
					steps,
					{steps: Array.empty<string>(), subject: text(context, first)},
					(current, step) =>
						Option.match(forwarding(context, step), {
							onNone: () => ({...current, steps: [...current.steps, text(context, step)]}),
							onSome: call => ({
								steps: [],
								subject: forwardCall(context, call, pipelineText(current.subject, current.steps))
							})
						})
				)
				return fixer.replaceText(node, pipelineText(direct.subject, direct.steps))
			},
			message: 'Use the curried operation as a pipeline step, not a forwarding arrow.',
			node
		})
		return
	}
	normalizeSingleStep(context, node)
}

function normalizeDual(context: LintContext, node: ESTree.CallExpression) {
	if (
		node.callee.type === 'CallExpression' &&
		Option.isSome(dual(context, node.callee.callee)) &&
		node.arguments.length === 1
	) {
		const curried = node.callee
		context.report({
			fix: fixer => {
				if (
					(!stable(context, node.arguments[0] ?? node) &&
						!Array.every(curried.arguments, arg => stable(context, arg))) ||
					node.arguments[0]?.type === 'SpreadElement'
				) {
					return []
				}
				return fixer.replaceText(
					node,
					`${text(context, curried.callee)}${typeArguments(context, curried)}(${argumentsText(context, directArguments(curried.callee, node.arguments, curried.arguments))})`
				)
			},
			message: 'Call a dual function data-first, never curried then applied.',
			node
		})
	}
	if (!dataFirst(context, node) || !dataFirst(context, node.arguments[0] ?? node)) return
	const pipeline = Option.getOrUndefined(chain(context, node))
	// An unstable argument cannot become a curried step without changing when it runs. Keep its direct calls.
	if (pipeline === undefined) return
	context.report({
		fix: fixer =>
			pipe(
				effectImport({context, fixer, name: 'pipe', node}),
				Option.map(imports => [
					...imports,
					fixer.replaceText(node, `pipe(${text(context, pipeline.subject)}, ${Array.join(pipeline.steps, ', ')})`)
				]),
				Option.getOrElse(() => [])
			),
		message: 'Two or more steps on a subject are a standalone pipe.',
		node
	})
}

export const effectCallForm = defineRule({
	create: context => ({
		CallExpression: node => {
			normalizeForwarding(context, node)
			normalizeCallee(context, node)
			normalizeSchema(context, node)
			normalizePipe(context, node)
			normalizeDual(context, node)
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
