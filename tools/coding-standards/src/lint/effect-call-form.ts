import {
	Array,
	Boolean,
	Cache,
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
	MutableHashMap,
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
	SynchronizedRef,
	pipe
} from 'effect'

import {Command} from 'effect/cli'
import {Headers, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Atom, AtomRegistry, AsyncResult, Reactivity} from 'effect/reactivity'
import {defineRule} from 'vite-plus/lint/plugins'
// oxlint-disable-next-line @deslop/coding-standards/no-renamed-import -- Effect's Context module and the linter's Context type are distinct contracts.
import type {Context as LintContext, ESTree} from 'vite-plus/lint/plugins'

import {
	effectImport,
	importedMember,
	isImportBinding,
	matches,
	memberName,
	returnedExpression,
	variableFromScope
} from '#lib/ast.ts'

const MODULES: Record.ReadonlyRecord<string, Record.ReadonlyRecord<string, unknown>> = {
	Array,
	AsyncResult,
	Atom,
	AtomRegistry,
	Boolean,
	Cache,
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
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerResponse,
	Layer,
	Match,
	MutableHashMap,
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
	SubscriptionRef,
	SynchronizedRef
}

function moduleSource(name: string) {
	if (name === 'Command') return 'effect/cli'
	if (Array.contains(['Atom', 'AtomRegistry', 'AsyncResult', 'Reactivity'], name)) return 'effect/reactivity'
	if (
		Array.contains(
			['Headers', 'HttpClient', 'HttpClientRequest', 'HttpClientResponse', 'HttpRouter', 'HttpServerResponse'],
			name
		)
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
				fn === Effect.withSpan ||
				fn === Effect.withParentSpan ||
				fn === Effect.withSpanScoped ||
				fn === Stream.withSpan ||
				fn === Layer.withSpan ||
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
				'Effect.sync',
				'Effect.sleep',
				'Effect.promise',
				'Effect.tryPromise',
				'Effect.suspend',
				'Effect.fail',
				'Effect.failCause',
				'Effect.die',
				// This installed API constructs an Effect; unlike annotateLogs, it has no subject overload.
				'Effect.annotateLogsScoped',
				'Ref.update',
				'Queue.offer',
				'String.includes',
				'String.startsWith',
				'String.endsWith',
				'String.slice',
				'String.match',
				'String.replace',
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
			`${node.callee.object.name}.${Option.getOrElse(memberName(node.callee), Function.constant(''))}`
		) &&
		isImportBinding({
			context,
			importedName: node.callee.object.name,
			node: node.callee.object,
			source: moduleSource(node.callee.object.name)
		})
	)
}

function pipelineStep(context: LintContext, node: ESTree.Node) {
	return (
		node.parent?.type === 'CallExpression' &&
		node.parent.arguments[0] !== node &&
		node.parent.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: node.parent.callee, source: 'effect'})
	)
}

function argumentKind(context: LintContext, node: ESTree.Node): string {
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return 'function'
	if (node.type === 'Literal' && Predicate.isString(node.value)) return 'string'
	if (node.type === 'TemplateLiteral') return 'string'
	if (node.type === 'ArrayExpression') return 'array'
	if (node.type === 'ObjectExpression') return 'object'
	if (node.type !== 'Identifier') return 'unknown'
	return pipe(
		variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}),
		Option.flatMap(variable => Array.head(variable.defs)),
		Option.map(definition => {
			if (definition.type === 'FunctionName') return 'function'
			const type = definition.name.typeAnnotation?.typeAnnotation
			if (type?.type === 'TSFunctionType') return 'function'
			if (type?.type === 'TSStringKeyword') return 'string'
			if (type?.type === 'TSArrayType') return 'array'
			if (type?.type === 'TSTypeLiteral') return 'object'
			if (
				definition.node.type === 'VariableDeclarator' &&
				definition.node.init !== null &&
				definition.node.init !== node
			) {
				return argumentKind(context, definition.node.init)
			}
			return 'unknown'
		}),
		Option.getOrElse(Function.constant('unknown'))
	)
}

// Predicate duals inspect an argument's kind, not a minimum arity: options occupy the same slot as a subject.
function predicateDataFirst(context: LintContext, callee: ESTree.MemberExpression, args: ESTree.Node[]) {
	const [first, second] = args
	if (first === undefined) return false
	const firstKind = argumentKind(context, first)
	const secondKind = Option.match(Option.fromUndefinedOr(second), {
		onNone: Function.constant('missing'),
		onSome: argument => argumentKind(context, argument)
	})
	const method = Option.getOrElse(memberName(callee), Function.constant(''))
	if (method === 'forEach') return secondKind === 'function' || (firstKind !== 'function' && secondKind === 'unknown')
	if (Array.contains(['zip', 'zipWith', 'raceFirst', 'race', 'merge'], method)) {
		return secondKind !== 'missing' && secondKind !== 'object'
	}
	if (
		Array.contains(
			['catchTag', 'catchReason', 'withSpan', 'withSpanScoped', 'setCookieUnsafe', 'expireCookieUnsafe'],
			method
		)
	) {
		return firstKind !== 'string' && firstKind !== 'array'
	}
	return !Array.contains(['function', 'object'], firstKind)
}

function dataFirst(context: LintContext, node: ESTree.Node): node is ESTree.CallExpression {
	if (node.type !== 'CallExpression') return false
	const callee = node.callee
	return (
		callee.type === 'MemberExpression' &&
		!node.optional &&
		!tagFirst(node.callee) &&
		!pipelineStep(context, node) &&
		!(node.parent.type === 'CallExpression' && node.parent.callee === node) &&
		!Array.some(node.arguments, argument => argument.type === 'SpreadElement') &&
		Option.exists(dual(context, callee), fn => {
			if (Number.isGreaterThan(fn.length, 0)) return node.arguments.length >= fn.length
			return predicateDataFirst(context, callee, node.arguments)
		})
	)
}

function immutable(context: LintContext, node: ESTree.Node) {
	if (Array.contains(['ThisExpression', 'Literal', 'ArrowFunctionExpression', 'FunctionExpression'], node.type)) {
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
					Array.contains(['ImportBinding', 'Parameter', 'ClassName', 'FunctionName'], definition.type) ||
					(definition.node.type === 'VariableDeclarator' &&
						definition.node.parent.type === 'VariableDeclaration' &&
						definition.node.parent.kind === 'const')
			)
	)
}

function stable(context: LintContext, node: ESTree.Node): boolean {
	return pipe(
		Match.value(node),
		Match.when({type: Match.is('TSAsExpression', 'TSSatisfiesExpression', 'TSInstantiationExpression')}, value =>
			stable(context, value.expression)
		),
		Match.when({type: 'TemplateLiteral'}, value =>
			Array.every(value.expressions, expression => stable(context, expression))
		),
		Match.when(
			{type: Match.is('BinaryExpression', 'LogicalExpression')},
			value => stable(context, value.left) && stable(context, value.right)
		),
		Match.when({type: 'UnaryExpression'}, value => value.operator !== 'delete' && stable(context, value.argument)),
		Match.when(
			{type: 'ConditionalExpression'},
			value => stable(context, value.test) && stable(context, value.consequent) && stable(context, value.alternate)
		),
		Match.when(
			{type: 'CallExpression'},
			value =>
				(stableConstructor(context, value) ||
					(Option.isSome(dual(context, value.callee)) && !dataFirst(context, value))) &&
				Array.every(value.arguments, arg => stable(context, arg))
		),
		Match.when({type: 'ArrayExpression'}, value =>
			Array.every(value.elements, element => element === null || stable(context, element))
		),
		Match.when({type: 'ObjectExpression'}, value =>
			Array.every(
				value.properties,
				property => property.type === 'Property' && !property.computed && stable(context, property.value)
			)
		),
		Match.when(
			{computed: false, type: 'MemberExpression'},
			value => transaction(context, value) || stable(context, value.object)
		),
		Match.orElse(value => immutable(context, value))
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

function chain(context: LintContext, node: ESTree.Node): Option.Option<{subject: ESTree.Node; steps: string[]}> {
	if (node.type !== 'CallExpression' || !dataFirst(context, node)) return Option.some({steps: [], subject: node})
	const [subject, ...args] = node.arguments
	if (subject === undefined || !Array.every(args, arg => stable(context, arg))) return Option.none()
	return Option.map(chain(context, subject), inner => ({
		steps: [
			...inner.steps,
			Boolean.match(Array.isArrayEmpty(args), {
				onFalse: () => `${text(context, node.callee)}${typeArguments(context, node)}(${argumentsText(context, args)})`,
				onTrue: () => `${text(context, node.callee)}${typeArguments(context, node)}`
			})
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
		Option.filter(variable => Array.every(variable.references, reference => reference.identifier === first)),
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

function unparenthesized(node: ESTree.Node) {
	if (node.type === 'ParenthesizedExpression') return unparenthesized(node.expression)
	return node
}

function normalizeForwarding(context: LintContext, node: ESTree.CallExpression) {
	const arrow = unparenthesized(node.callee)
	if (arrow.type !== 'ArrowFunctionExpression') return
	const subject = node.arguments[0]
	context.report({
		fix: fixer => {
			if (subject === undefined || subject.type === 'SpreadElement' || node.arguments.length !== 1) return []
			return Option.match(plainForwarding(context, arrow), {
				onNone: () => [],
				onSome: call => [fixer.replaceText(node, forwardCall(context, call, text(context, subject)))]
			})
		},
		message: 'Write this computation plainly instead of immediately applying an arrow.',
		node
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
		schemaOperation(context, node.callee.callee, ['withDecodingDefaultKey', 'withDecodingDefaultTypeKey']) &&
		node.arguments.length === 1 &&
		node.arguments[0] !== undefined &&
		node.arguments[0].type !== 'SpreadElement'
	) {
		const subject = node.arguments[0]
		const curried = node.callee
		context.report({
			fix: fixer =>
				pipe(
					effectImport({context, fixer, name: 'pipe', node}),
					Option.map(imports => [
						...imports,
						fixer.replaceText(node, `pipe(${text(context, subject)}, ${text(context, curried)})`)
					]),
					Option.getOrElse(() => [])
				),
			message: 'Keep a curried-only schema operation as a pipeline step.',
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
	if (
		step.type === 'CallExpression' &&
		!Option.isSome(dual(context, step.callee)) &&
		!schemaOperation(context, step.callee, ['check', 'annotate'])
	) {
		return
	}
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
	if (node.arguments.length === 2) {
		normalizeSingleStep(context, node)
		return
	}
	const forwarded = Array.map(steps, step => plainForwarding(context, step))
	if (Array.some(forwarded, Option.isSome)) {
		context.report({
			fix: fixer => {
				if (first === undefined || first.type === 'SpreadElement') return []
				if (
					node.arguments.length > 2 &&
					Array.some(forwarded, call =>
						Option.exists(call, operation => Option.isNone(dual(context, operation.callee)))
					)
				) {
					return []
				}
				const safe = Array.every(forwarded, call =>
					Option.match(call, {
						onNone: Function.constTrue,
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
	}
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
	context.report({
		fix: fixer => {
			if (pipeline === undefined) return []
			return pipe(
				effectImport({context, fixer, name: 'pipe', node}),
				Option.map(imports => [
					...imports,
					fixer.replaceText(node, `pipe(${text(context, pipeline.subject)}, ${Array.join(pipeline.steps, ', ')})`)
				]),
				Option.getOrElse(() => [])
			)
		},
		message: 'Two or more steps on a subject are a standalone pipe.',
		node
	})
}

function namedGeneratorBoundary(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	return (
		node.async ||
		node.generator ||
		node.returnType !== null ||
		node.parent.type === 'VariableDeclarator' ||
		node.parent.type === 'PropertyDefinition' ||
		node.type === 'FunctionDeclaration' ||
		(node.type === 'FunctionExpression' && node.id !== null)
	)
}

function effectProperty(context: LintContext, returned: ESTree.CallExpression) {
	return (
		(returned.callee.type === 'Identifier' &&
			isImportBinding({context, importedName: 'pipe', node: returned.callee, source: 'effect'}) &&
			Array.some(
				returned.arguments,
				argument =>
					argument.type !== 'SpreadElement' &&
					(importedMember({context, importedName: 'Effect', node: argument}) ||
						(argument.type === 'CallExpression' &&
							importedMember({context, importedName: 'Effect', node: argument.callee})))
			)) ||
		importedMember({context, importedName: 'Effect', node: returned.callee, propertyName: 'tryPromise'})
	)
}

function generatorBody(context: LintContext, returned: ESTree.CallExpression) {
	const generator = returned.arguments[0]
	if (
		generator?.type !== 'FunctionExpression' ||
		!generator.generator ||
		generator.async ||
		generator.id !== null ||
		generator.body === null ||
		Array.isArrayNonEmpty(generator.params) ||
		Option.isSome(String.match(/\b(?:arguments|this)\b/u)(context.sourceCode.getText(generator.body)))
	)
		{return Option.none<ESTree.FunctionBody>()}
	return Option.some(generator.body)
}

function normalizeGenerator(context: LintContext, node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (namedGeneratorBoundary(node)) return
	const returned = returnedExpression(node)
	if (returned?.type !== 'CallExpression') return
	if (node.parent.type === 'Property') {
		if (Array.isArrayNonEmpty(node.params) && effectProperty(context, returned)) {
			context.report({
				message:
					'Define the Effect property with Effect.fnUntraced(function* (input) { return yield* work }), or Effect.fn("Service.method")(function* …) for a traced boundary.',
				node
			})
		}
		return
	}
	if (
		!importedMember({context, importedName: 'Effect', node: returned.callee, propertyName: 'gen'}) ||
		returned.arguments.length !== 1 ||
		!Array.every(
			node.params,
			parameter => parameter.type === 'Identifier' && Predicate.isNotNullish(parameter.typeAnnotation)
		)
	) {
		return
	}
	Option.match(generatorBody(context, returned), {
		onNone: Function.constVoid,
		onSome: body =>
			context.report({
				fix: fixer => {
					const parameters = pipe(
						node.params,
						Array.map(parameter => context.sourceCode.getText(parameter)),
						Array.join(', ')
					)
					return fixer.replaceText(
						node,
						`Effect.fnUntraced(function* ${Option.match(Option.fromNullishOr(node.typeParameters), {onNone: Function.constant(''), onSome: type => context.sourceCode.getText(type)})}(${parameters}) ${context.sourceCode.getText(body)})`
					)
				},
				message:
					'Pass the generator to Effect.fnUntraced(function* (input) { … }); use Effect.fn("Service.method") for a traced boundary.',
				node
			})
	})
}

export const effectCallForm = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => normalizeGenerator(context, node),
		CallExpression: node => {
			normalizeForwarding(context, node)
			normalizeCallee(context, node)
			normalizeSchema(context, node)
			normalizePipe(context, node)
			normalizeDual(context, node)
		},
		FunctionExpression: node => normalizeGenerator(context, node)
	}),
	meta: {fixable: 'code', type: 'problem'}
})
