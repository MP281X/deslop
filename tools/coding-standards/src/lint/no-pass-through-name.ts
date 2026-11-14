import {Array, Function, MutableList, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	boundReads,
	childNodes,
	composedSteps,
	effectImport,
	importedMember,
	inert,
	isSchemaOperationCall,
	matches,
	memberName,
	outermost,
	readable,
	readsOf,
	returnedExpression,
	rootName,
	singleRead,
	singleUseThunk,
	suspends,
	typeWrapped,
	variableOf,
	variableFromScope
} from '#lib/ast.ts'
import {singleUseModulePrimitive} from '#lib/module-literal.ts'

const OPTION_WRAPS = ['fromNullOr', 'fromNullishOr', 'fromUndefinedOr', 'some']
const OPTION_UNWRAPS = ['getOrElse', 'getOrNull', 'getOrUndefined']
const REPEATING = [
	'ArrowFunctionExpression',
	'DoWhileStatement',
	'ForInStatement',
	'ForOfStatement',
	'ForStatement',
	'FunctionDeclaration',
	'FunctionExpression',
	'WhileStatement'
]

function isExport(node: ESTree.Node | null) {
	return node?.type === 'ExportNamedDeclaration' || node?.type === 'ExportDefaultDeclaration'
}

function constantFunction(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (
		input.node.async ||
		input.node.generator ||
		Array.isArrayNonEmpty(input.node.params) ||
		Predicate.isNotNullish(input.node.typeParameters) ||
		isExport(input.node.parent) ||
		(input.node.parent.type === 'VariableDeclarator' && isExport(input.node.parent.parent.parent)) ||
		(input.node.type !== 'FunctionDeclaration' &&
			!(
				input.node.parent.type === 'VariableDeclarator' &&
				input.node.parent.parent.type === 'VariableDeclaration' &&
				input.node.parent.parent.kind === 'const'
			))
	) {
		return false
	}
	const returned = returnedExpression(input.node)
	return (
		Predicate.isNotNullish(returned) &&
		((returned.type === 'Literal' && !Predicate.hasProperty(returned, 'regex')) ||
			(returned.type === 'TemplateLiteral' && Array.isArrayEmpty(returned.expressions))) &&
		Option.exists(boundReads(input), reads =>
			Array.every(
				reads,
				reference =>
					reference.identifier.parent.type === 'CallExpression' &&
					reference.identifier.parent.callee === reference.identifier
			)
		)
	)
}

function parameterName(parameter: ESTree.ParamPattern) {
	if (parameter.type === 'Identifier') return Option.some(parameter.name)
	if (parameter.type === 'RestElement' && parameter.argument.type === 'Identifier') {
		return Option.some(parameter.argument.name)
	}
	return Option.none()
}

function parametersOf(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	return pipe(node.params, Array.map(parameterName), Array.getSomes)
}

function forwarded(input: {args: ESTree.CallExpression['arguments']; names: string[]}) {
	return (
		input.args.length === input.names.length &&
		Array.every(input.args, (argument, index) => {
			const name = input.names[index]
			if (argument.type === 'SpreadElement') {
				return argument.argument.type === 'Identifier' && argument.argument.name === name
			}
			return argument.type === 'Identifier' && argument.name === name
		})
	)
}

function callGroups(node: ESTree.Node): {callee: ESTree.Node; groups: ESTree.CallExpression['arguments'][]} {
	if (node.type !== 'CallExpression') return {callee: node, groups: []}
	const inner = callGroups(node.callee)
	return {callee: inner.callee, groups: Array.append(inner.groups, node.arguments)}
}

// Effect modules export plain functions, so `Effect.succeed` runs without `this`; a method such as `Schema.String.annotate` needs its receiver.
function detachable(input: {context: Context; node: ESTree.Node}) {
	if (input.node.type === 'Identifier') return true
	if (input.node.type !== 'MemberExpression' || input.node.object.type !== 'Identifier') return false
	return pipe(
		rootName(input.node),
		Option.flatMap(name => variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)})),
		Option.exists(variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.type === 'ImportBinding' &&
					definition.parent?.type === 'ImportDeclaration' &&
					// `effect` exports its modules, and `effect/Schema` exports objects such as `String` too.
					(definition.parent.source.value === 'effect' ||
						(definition.node.type === 'ImportNamespaceSpecifier' &&
							matches(/^effect\//u)(definition.parent.source.value)))
			)
		)
	)
}

function forwardedChain(input: {context: Context; names: string[]; returned: ESTree.Node}) {
	const chain = callGroups(input.returned)
	function fixed(node: ESTree.Node) {
		return node.type === 'Literal' || Option.exists(rootName(node), root => !Array.contains(input.names, root))
	}
	return Array.matchRight(chain.groups, {
		onEmpty: Function.constFalse,
		onNonEmpty: (earlier, last) =>
			fixed(chain.callee) &&
			Array.every(Array.flatten(earlier), fixed) &&
			forwarded({args: last, names: input.names}) &&
			(Array.isArrayNonEmpty(earlier) || detachable({context: input.context, node: chain.callee}))
	})
}

function exactForwardingFunction(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	const names = parametersOf(input.node)
	const returned = returnedExpression(input.node)
	// An async function also turns a throw into a rejected Promise, and a generator returns an iterator.
	if (
		input.node.async ||
		input.node.generator ||
		!Option.exists(boundReads(input), reads => reads.length === 1) ||
		Array.isArrayEmpty(names) ||
		names.length !== input.node.params.length ||
		Predicate.isNullish(returned)
	) {
		return false
	}
	if (returned.type === 'Identifier') return names.length === 1 && returned.name === names[0]
	return (
		(returned.type === 'NewExpression' &&
			returned.callee.type === 'Identifier' &&
			forwarded({args: returned.arguments, names})) ||
		forwardedChain({context: input.context, names, returned})
	)
}

function isIdentity(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	const [parameter] = node.params
	const returned = returnedExpression(node)
	return (
		node.params.length === 1 &&
		parameter?.type === 'Identifier' &&
		returned?.type === 'Identifier' &&
		returned.name === parameter.name
	)
}

function indirectionMessage(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (constantFunction(input) && !singleUseThunk(input)) {
		return 'Inline this argument-free literal return at its call sites.'
	}
	if (isIdentity(input.node)) return 'Pass Function.identity from effect instead of this function.'
	const returned = returnedExpression(input.node)
	if (exactForwardingFunction(input) && returned?.type === 'CallExpression') {
		return `Use ${input.context.sourceCode.getText(returned.callee)} directly; this function only passes its parameters on.`
	}
	return 'Inline this function at its only use: write its body where it is called, or pass `parameter => body` where it is passed; rename a parameter that would shadow.'
}

function unexportedBindingName(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.type === 'FunctionDeclaration' && node.id !== null && !isExport(node.parent)) {
		return Option.some(node.id.name)
	}
	if (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.id.type === 'Identifier' &&
		node.parent.id.typeAnnotation === null &&
		!isExport(node.parent.parent.parent)
	) {
		return Option.some(node.parent.id.name)
	}
	return Option.none()
}

// Inlining a call copies each argument into every use of its parameter, so only a name or a literal may be read twice.
function copiesSafely(input: {
	call: ESTree.CallExpression
	context: Context
	names: string[]
	returned: ESTree.Expression
}) {
	return Array.every(input.names, (name, index) => {
		const argument = input.call.arguments[index]
		return (
			argument?.type === 'Identifier' ||
			argument?.type === 'Literal' ||
			Option.exists(
				variableFromScope({name, scope: input.context.sourceCode.getScope(input.returned)}),
				variable => variable.references.length <= 1
			)
		)
	})
}

// A function read once, as a call or an argument, reads better as its body there: one line anywhere, a longer call only where readable allows it.
function singleUseFunction(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	const names = parametersOf(input.node)
	const returned = returnedExpression(input.node)
	if (
		input.node.async ||
		input.node.generator ||
		input.node.typeParameters !== null ||
		input.node.returnType?.typeAnnotation.type === 'TSTypePredicate' ||
		Array.isArrayEmpty(names) ||
		names.length !== input.node.params.length ||
		Predicate.isNullish(returned)
	) {
		return false
	}
	const oneLine = !String.includes('\n')(input.context.sourceCode.getText(returned))
	return pipe(
		unexportedBindingName(input.node),
		Option.flatMap(name => singleRead({context: input.context, name, node: input.node})),
		Option.filter(read => read.range[0] < input.node.range[0] || read.range[0] > input.node.range[1]),
		Option.exists(read => {
			if (read.parent.type !== 'CallExpression') return false
			if (read.parent.callee !== read) {
				return oneLine && Array.some(read.parent.arguments, argument => argument === read)
			}
			if (!copiesSafely({call: read.parent, context: input.context, names, returned})) return false
			return (
				oneLine ||
				(returned.type === 'CallExpression' && readable({context: input.context, init: returned, read: read.parent}))
			)
		})
	)
}

function redundantConstAlias(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null ||
		input.node.init?.type !== 'Identifier' ||
		!Option.exists(variableOf(input.context, input.node.init), variable => {
			if (Array.some(variable.references, reference => reference.isWrite() && !reference.init)) return false
			return Array.some(variable.defs, definition => {
				if (definition.type === 'ImportBinding' || definition.type === 'Parameter') return true
				return (
					definition.node.type === 'VariableDeclarator' &&
					definition.node.parent.type === 'VariableDeclaration' &&
					definition.node.parent.kind === 'const'
				)
			})
		})
	) {
		return false
	}
	return Option.exists(
		readsOf({context: input.context, name: input.node.id.name, node: input.node}),
		reads => reads.length === 1
	)
}

function exportedAlias(input: {context: Context; node: ESTree.VariableDeclarator}) {
	return (
		input.node.parent.type === 'VariableDeclaration' &&
		input.node.parent.kind === 'const' &&
		input.node.parent.parent.type === 'ExportNamedDeclaration' &&
		input.node.id.type === 'Identifier' &&
		input.node.init?.type === 'Identifier' &&
		Option.exists(variableOf(input.context, input.node.init), variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.type === 'ImportBinding' ||
					definition.type === 'FunctionName' ||
					definition.type === 'ClassName' ||
					(definition.node.type === 'VariableDeclarator' &&
						definition.node.parent.type === 'VariableDeclaration' &&
						definition.node.parent.kind === 'const')
			)
		)
	)
}

function privateConstReads(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		isExport(input.node.parent.parent) ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null
	) {
		return Option.none()
	}
	return readsOf({context: input.context, name: input.node.id.name, node: input.node})
}

function singleUseLiteral(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (input.node.parent.parent?.type === 'Program') return singleUseModulePrimitive(input.context, input.node)
	if (
		!(
			(input.node.init?.type === 'Literal' && !Predicate.hasProperty(input.node.init, 'regex')) ||
			(input.node.init?.type === 'TemplateLiteral' && Array.isArrayEmpty(input.node.init.expressions))
		)
	) {
		return false
	}
	return Option.exists(
		privateConstReads(input),
		reads => reads.length === 1 && reads[0]?.identifier.parent.type !== 'ExportSpecifier'
	)
}

function singleUseLayerPart(input: {context: Context; node: ESTree.VariableDeclarator}) {
	const init = input.node.init
	if (
		init === null ||
		// Only a `.layer` read or an `Effect.gen` call can be a layer part; checking that first skips scope analysis.
		!(
			(init.type === 'MemberExpression' && Option.contains(memberName(init), 'layer')) ||
			(init.type === 'CallExpression' &&
				importedMember({context: input.context, importedName: 'Effect', node: init.callee, propertyName: 'gen'}))
		)
	) {
		return false
	}
	return Option.exists(privateConstReads(input), reads => {
		const consumer = reads[0]?.identifier.parent
		if (reads.length !== 1 || consumer?.type !== 'CallExpression') return false
		if (init.type === 'MemberExpression') {
			return (
				importedMember({context: input.context, importedName: 'Layer', node: consumer.callee}) ||
				importedMember({context: input.context, importedName: 'Effect', node: consumer.callee, propertyName: 'provide'})
			)
		}
		return (
			consumer.arguments[1] === reads[0]?.identifier &&
			importedMember({context: input.context, importedName: 'Layer', node: consumer.callee, propertyName: 'effect'})
		)
	})
}

// A capitalized function is a React component: its name is the hook boundary and the DevTools label.
function isComponent(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.type === 'FunctionDeclaration') {
		return Option.exists(Option.fromNullishOr(node.id), id => matches(/^[A-Z]/u)(id.name))
	}
	return (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.id.type === 'Identifier' &&
		matches(/^[A-Z]/u)(node.parent.id.name)
	)
}

// `catch: cause => cause` is preserve-error-cause's and any-unknown-in-error-context's finding, not an indirection.
function isCatchHandler(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	return (
		node.parent.type === 'Property' &&
		!node.parent.computed &&
		node.parent.key.type === 'Identifier' &&
		node.parent.key.name === 'catch'
	)
}

function reportsIndirection(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	return (
		constantFunction(input) ||
		((input.node.type === 'FunctionDeclaration' ||
			input.node.parent.type === 'VariableDeclarator' ||
			input.node.parent.type === 'Property' ||
			(input.node.type === 'FunctionExpression' &&
				input.node.parent.type === 'MethodDefinition' &&
				input.node.parent.override !== true)) &&
			!isComponent(input.node) &&
			!isCatchHandler(input.node) &&
			(exactForwardingFunction(input) || singleUseThunk(input) || singleUseFunction(input)))
	)
}

function identityCallback(node: ESTree.ArrowFunctionExpression) {
	return (
		!node.async &&
		node.typeParameters === null &&
		node.returnType === null &&
		node.params[0]?.type === 'Identifier' &&
		node.params[0].typeAnnotation === null &&
		node.parent.type === 'CallExpression' &&
		node.parent.callee !== node &&
		isIdentity(node)
	)
}

function booleanBranch(input: {context: Context; node: ESTree.CallExpression}) {
	const [condition, options] = input.node.arguments
	return (
		input.node.arguments.length === 2 &&
		condition?.type !== 'SpreadElement' &&
		importedMember({context: input.context, importedName: 'Boolean', node: input.node.callee, propertyName: 'match'}) &&
		options?.type === 'ObjectExpression' &&
		options.properties.length === 2 &&
		Array.every(['onFalse', 'onTrue'], name =>
			Array.some(
				options.properties,
				property =>
					property.type === 'Property' &&
					property.kind === 'init' &&
					!property.computed &&
					!property.method &&
					!property.shorthand &&
					property.key.type === 'Identifier' &&
					property.key.name === name &&
					property.value.type === 'ArrowFunctionExpression' &&
					!property.value.async &&
					Array.isArrayEmpty(property.value.params) &&
					property.value.body.type !== 'BlockStatement'
			)
		)
	)
}

function componentIndirection(context: Context, node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	const returned = returnedExpression(node)
	if (
		isComponent(node) &&
		returned?.type === 'JSXElement' &&
		returned.openingElement.name.type === 'JSXIdentifier' &&
		matches(/^[A-Z]/u)(returned.openingElement.name.name) &&
		!matches(/components-mobile[/\\]src[/\\]ui[/\\]/u)(context.filename)
	) {
		const parameter = node.params[0]
		const name = Option.getOrUndefined(unexportedBindingName(node))
		if (name === undefined || !Option.exists(readsOf({context, name, node}), reads => reads.length === 1)) return
		function forwardedProp(value: ESTree.Node, property: string) {
			return (
				value.type === 'MemberExpression' &&
				!value.computed &&
				value.property.type === 'Identifier' &&
				value.property.name === property &&
				value.object.type === 'Identifier' &&
				parameter?.type === 'Identifier' &&
				value.object.name === parameter.name
			)
		}
		if (parameter?.type !== 'Identifier' || parameter.typeAnnotation?.typeAnnotation.type !== 'TSTypeLiteral') return
		const props = parameter.typeAnnotation.typeAnnotation.members
		if (
			props.length === returned.openingElement.attributes.length &&
			Array.every(
				returned.openingElement.attributes,
				attribute =>
					attribute.type === 'JSXAttribute' &&
					attribute.name.type === 'JSXIdentifier' &&
					Array.some(
						props,
						prop =>
							prop.type === 'TSPropertySignature' &&
							prop.key.type === 'Identifier' &&
							prop.key.name === attribute.name.name
					) &&
					attribute.value?.type === 'JSXExpressionContainer' &&
					forwardedProp(attribute.value.expression, attribute.name.name)
			) &&
			Array.every(
				returned.children,
				child =>
					(child.type === 'JSXText' && String.trim(child.value) === '') ||
					(child.type === 'JSXExpressionContainer' && forwardedProp(child.expression, 'children'))
			)
		) {
			context.report({message: 'Render the underlying component directly; this component only forwards props.', node})
		}
	}
}

function compilerConstant(context: Context, node: ESTree.Node): boolean {
	if (Predicate.isNullish(node.parent)) return false
	if (node.parent.type === 'Property' && node.parent.parent.type === 'ObjectExpression') {
		return compilerConstant(context, node.parent.parent)
	}
	return (
		node.parent.type === 'CallExpression' &&
		node.parent.callee.type === 'MemberExpression' &&
		importedMember({context, importedName: 'Effect', node: node.parent.callee}) &&
		Option.exists(memberName(node.parent.callee), method =>
			Array.contains(['map', 'match', 'matchEffect', 'sync'], method)
		)
	)
}

function constantName(node: ESTree.Node) {
	if (node.type === 'Identifier') return 'constUndefined'
	if (node.type === 'Literal' && node.value === null) return 'constNull'
	if (node.type === 'Literal' && node.value === true) return 'constTrue'
	return 'constFalse'
}

function unwrapped(node: ESTree.Node): ESTree.Node {
	return Option.match(typeWrapped(node), {onNone: () => node, onSome: unwrapped})
}

function runsOnce(node: ESTree.Node, statement: ESTree.Node): boolean {
	if (node === statement) return true
	if (node.parent === null) return false
	if (
		((node.parent.type === 'ForOfStatement' || node.parent.type === 'ForInStatement') && node.parent.right === node) ||
		(node.parent.type === 'IfStatement' && node.parent.test === node) ||
		(node.parent.type === 'ConditionalExpression' && node.parent.test === node) ||
		(node.parent.type === 'LogicalExpression' && node.parent.left === node)
	) {
		return runsOnce(node.parent, statement)
	}
	if (
		Array.contains(
			[
				...REPEATING,
				'IfStatement',
				'ConditionalExpression',
				'LogicalExpression',
				'ChainExpression',
				'SwitchStatement',
				'TryStatement'
			],
			node.parent.type
		)
	) {
		return false
	}
	return runsOnce(node.parent, statement)
}

function insideConditional(node: ESTree.Node, statement: ESTree.Node): boolean {
	if (node === statement) return false
	if (node.type === 'ConditionalExpression') return true
	return node.parent !== null && insideConditional(node.parent, statement)
}

function executes(context: Context, node: ESTree.Node): boolean {
	if (
		Array.contains(
			[
				'AwaitExpression',
				'CallExpression',
				'MemberExpression',
				'NewExpression',
				'SpreadElement',
				'TaggedTemplateExpression',
				'YieldExpression'
			],
			node.type
		)
	) {
		return true
	}
	if (Array.contains(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'], node.type)) return false
	return Array.some(childNodes(context, node), child => executes(context, child))
}

function inlineValue(context: Context, init: ESTree.Expression, read: ESTree.Node, name: string, next: ESTree.Node) {
	const value = `(${context.sourceCode.getText(init)})`
	if (read.parent?.type === 'Property' && read.parent.shorthand) return `${name}: ${value}`
	if (read.range[0] === next.range[0]) return `;${value}`
	return value
}

function callableReceiver(read: ESTree.Node) {
	return (
		read.parent?.type === 'MemberExpression' &&
		read.parent.object === read &&
		read.parent.parent.type === 'CallExpression' &&
		read.parent.parent.callee === read.parent
	)
}

function replaceableValue(init: ESTree.Expression, read: ESTree.Node) {
	const used = outermost(read)
	return !(
		Array.contains(['ClassExpression', 'ObjectExpression'], unwrapped(init).type) ||
		(used.parent?.type === 'CallExpression' && used.parent.callee === used) ||
		(used.parent?.type === 'TaggedTemplateExpression' && used.parent.tag === used)
	)
}

function bindingCandidate(context: Context, node: ESTree.VariableDeclarator) {
	if (
		node.parent.type !== 'VariableDeclaration' ||
		node.parent.kind !== 'const' ||
		node.parent.declarations.length !== 1 ||
		node.parent.parent.type !== 'BlockStatement' ||
		node.id.type !== 'Identifier' ||
		node.id.typeAnnotation !== null ||
		node.init === null
	) {
		return false
	}
	return (
		!redundantConstAlias({context, node}) &&
		!Array.contains(
			['ArrowFunctionExpression', 'FunctionExpression', 'JSXElement', 'JSXFragment'],
			unwrapped(node.init).type
		) &&
		!(node.init.type === 'CallExpression' && isSchemaOperationCall({context, node: node.init})) &&
		!(node.init.type === 'MemberExpression' && Option.isSome(rootName(node.init))) &&
		!(node.init.type === 'Literal' && !Predicate.hasProperty(node.init, 'regex')) &&
		!(node.init.type === 'TemplateLiteral' && Array.isArrayEmpty(node.init.expressions)) &&
		!singleUseLayerPart({context, node})
	)
}

function inlinePlan(context: Context, node: ESTree.VariableDeclarator, executed: ESTree.Node[]) {
	if (
		node.init === null ||
		!bindingCandidate(context, node) ||
		node.id.type !== 'Identifier' ||
		node.parent.type !== 'VariableDeclaration' ||
		node.parent.parent.type !== 'BlockStatement'
	) {
		return Option.none()
	}
	const declaration = node.parent
	const init = node.init
	const name = node.id.name
	const statements = node.parent.parent.body
	return pipe(
		statements,
		Array.findFirstIndex(statement => statement === declaration),
		Option.flatMap(index => Array.get(statements, index + 1)),
		Option.flatMap(next =>
			pipe(
				singleRead({context, name, node}),
				Option.filter(
					read =>
						read.range[0] >= next.range[0] &&
						read.range[1] <= next.range[1] &&
						runsOnce(read, next) &&
						readable({context, init, read}) &&
						!(init.type === 'ConditionalExpression' && insideConditional(read, next)) &&
						!(suspends(context, init) && callableReceiver(outermost(read))) &&
						!Array.some(
							executed,
							effectNode => effectNode.range[0] >= next.range[0] && effectNode.range[1] <= read.range[0]
						)
				),
				Option.map(read => ({next, read}))
			)
		),
		Option.map(found => ({...found, declaration, init, name}))
	)
}

export function discardedBindingName(context: Context, node: ESTree.Node, executed: ESTree.Node[]) {
	if (node.type === 'FunctionDeclaration') return reportsIndirection({context, node})
	if (node.type !== 'VariableDeclarator' || node.init === null) return false
	if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
		return reportsIndirection({context, node: node.init})
	}
	return (
		exportedAlias({context, node}) ||
		redundantConstAlias({context, node}) ||
		singleUseLiteral({context, node}) ||
		singleUseLayerPart({context, node}) ||
		Array.contains(['JSXElement', 'JSXFragment'], unwrapped(node.init).type) ||
		Option.isSome(inlinePlan(context, node, executed))
	)
}

function checkBinding(context: Context, node: ESTree.VariableDeclarator, executed: ESTree.Node[]) {
	if (node.init !== null && Array.contains(['JSXElement', 'JSXFragment'], unwrapped(node.init).type)) {
		context.report({
			message: 'Write the element where it renders, or make it a component when several places render it.',
			node
		})
		return
	}
	Option.map(inlinePlan(context, node, executed), found =>
		context.report({
			fix: fixer => {
				if (
					!replaceableValue(found.init, found.read) ||
					(executes(context, found.init) &&
						!Array.every(context.sourceCode.getTokensBetween(found.declaration, found.read), inert))
				) {
					return []
				}
				return [
					fixer.remove(found.declaration),
					fixer.replaceText(found.read, inlineValue(context, found.init, found.read, found.name, found.next))
				]
			},
			message: 'Inline this value into the next statement, its only use.',
			node
		})
	)
}

export const noPassThroughName = defineRule({
	create: context => {
		const effects = MutableList.make<ESTree.Node>()
		const bindings = MutableList.make<ESTree.VariableDeclarator>()
		function effect(node: ESTree.Node) {
			MutableList.append(effects, node)
		}
		function checkFunction(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			if (
				node.type !== 'FunctionDeclaration' &&
				node.parent.type !== 'VariableDeclarator' &&
				!node.async &&
				!node.generator &&
				Array.isArrayEmpty(node.params)
			) {
				const returned = returnedExpression(node)
				const literal = returned?.type === 'Literal' && (returned.value === null || Predicate.isBoolean(returned.value))
				const undefinedValue =
					returned?.type === 'Identifier' &&
					returned.name === 'undefined' &&
					!Option.exists(variableOf(context, returned), variable => Array.isArrayNonEmpty(variable.defs))
				if ((literal || undefinedValue) && !compilerConstant(context, node)) {
					const replacement = constantName(returned)
					context.report({
						fix: fixer =>
							pipe(
								effectImport({context, fixer, name: 'Function', node}),
								Option.map(imports => [...imports, fixer.replaceText(node, `Function.${replacement}`)]),
								Option.getOrElse(() => [])
							),
						message: `Use Function.${replacement} for a fixed-value callback.`,
						node
					})
					return
				}
			}
			componentIndirection(context, node)
			if (reportsIndirection({context, node})) {
				context.report({message: indirectionMessage({context, node}), node})
			}
		}
		return {
			ArrowFunctionExpression: node => {
				if (identityCallback(node) && node.parent.type === 'CallExpression') {
					const call = node.parent
					if (
						Array.some(['Array', 'Effect', 'Option'], importedName =>
							importedMember({context, importedName, node: call.callee, propertyName: 'map'})
						)
					) {
						context.report({message: 'Remove this identity map; use Array.copy if a separate array is required.', node})
						return
					}
					context.report({message: 'Pass Function.identity from effect instead of this callback.', node})
					return
				}
				checkFunction(node)
			},
			AssignmentExpression: effect,
			AwaitExpression: effect,
			CallExpression: node => {
				effect(node)
				for (const composition of composedSteps(context, node)) {
					if (
						composition.inner.module === 'Option' &&
						composition.outer.module === 'Option' &&
						Array.contains(OPTION_WRAPS, composition.inner.name) &&
						Array.contains(OPTION_UNWRAPS, composition.outer.name)
					) {
						context.report({
							message: `Use the value itself, with ?? for a fallback; Option.${composition.outer.name} undoes Option.${composition.inner.name}.`,
							node: composition.report
						})
					}
				}
			},
			FunctionDeclaration: checkFunction,
			FunctionExpression: checkFunction,
			NewExpression: effect,
			'Program:exit': () => {
				const executed = MutableList.toArray(effects)
				for (const node of MutableList.toArray(bindings)) {
					checkBinding(context, node, executed)
				}
			},
			ReturnStatement: node => {
				if (node.parent.type !== 'BlockStatement' || node.argument?.type !== 'CallExpression') return
				if (
					(node.parent.parent.type !== 'FunctionDeclaration' &&
						node.parent.parent.type !== 'FunctionExpression' &&
						node.parent.parent.type !== 'ArrowFunctionExpression') ||
					node.parent.parent.body !== node.parent ||
					reportsIndirection({context, node: node.parent.parent}) ||
					!booleanBranch({context, node: node.argument})
				) {
					return
				}
				context.report({
					message: 'Return early: if (condition) return the onTrue value, then return the onFalse value.',
					node
				})
			},
			TSTypeAliasDeclaration: node => {
				if (
					node.typeAnnotation.type === 'TSTypeReference' &&
					node.typeAnnotation.typeName.type === 'Identifier' &&
					Predicate.isNullish(node.typeAnnotation.typeArguments) &&
					Predicate.isNullish(node.typeParameters)
				) {
					context.report({message: 'Use the referenced type directly; this second name is an alias.', node})
				}
			},
			TaggedTemplateExpression: effect,
			UpdateExpression: effect,
			VariableDeclarator: node => {
				MutableList.append(bindings, node)
				if (
					node.id.type === 'Identifier' &&
					node.init?.type === 'CallExpression' &&
					!isExport(node.parent.parent) &&
					(importedMember({context, importedName: 'Effect', node: node.init.callee, propertyName: 'fnUntraced'}) ||
						(node.init.callee.type === 'CallExpression' &&
							importedMember({context, importedName: 'Effect', node: node.init.callee.callee, propertyName: 'fn'})))
				) {
					const callback = node.init.arguments[0]
					if (
						callback?.type === 'FunctionExpression' &&
						callback.generator &&
						callback.returnType === null &&
						returnedExpression(callback)?.type === 'YieldExpression' &&
						Option.exists(
							readsOf({context, name: node.id.name, node}),
							reads => reads.length === 1 && reads[0]?.identifier.parent.type !== 'ExportSpecifier'
						)
					) {
						context.report({
							message: 'Write this single-step effect at its only use; the helper adds no capability.',
							node
						})
					}
				}
				if (exportedAlias({context, node})) {
					context.report({message: 'Export the value under one name; this second name is an alias.', node})
				}
				if (redundantConstAlias({context, node})) {
					context.report({
						message: `Use ${context.sourceCode.getText(node.init)} directly; this name is an alias.`,
						node
					})
				}
				if (singleUseLiteral({context, node})) {
					context.report({message: 'Inline this literal at its only use site.', node})
				}
				if (singleUseLayerPart({context, node})) {
					context.report({message: 'Write this layer part where its only layer uses it.', node})
				}
			},
			YieldExpression: effect
		}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{'sample.ts': 'export function doubleOf(value: number) { return value * 2 }'},
					{'sample.tsx': 'export function Title(props: {title: string}) { return <span>{props.title}</span> }'},
					{
						'sample.ts': `import {Function, Option} from 'effect'
export function defaults(value: Option.Option<boolean>) { return [Option.getOrElse(value, Function.constFalse), Option.getOrElse(value, Function.constTrue), Option.getOrElse(value, Function.constNull), Option.getOrElse(value, Function.constUndefined)] }`
					}
				],
				fixes: [
					{'sample.ts': 'export function doubleOf(value: number) { const doubled = value * 2; return doubled }'},
					{
						'sample.ts': `import {Option} from 'effect'
export function defaults(value: Option.Option<boolean>) { return [Option.getOrElse(value, () => false), Option.getOrElse(value, () => true), Option.getOrElse(value, () => null), Option.getOrElse(value, () => undefined)] }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
