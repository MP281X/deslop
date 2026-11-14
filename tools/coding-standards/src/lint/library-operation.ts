import {Array, Boolean, Function, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {
	argumentsText,
	childNodes,
	composedSteps,
	containsNode,
	effectImport,
	importedMember,
	isFilteredCount,
	isFunction,
	lengthTest,
	matches,
	memberName,
	returnedExpression,
	variableFromScope,
	variableOf
} from '#lib/ast.ts'

const GUARDS: Record<string, string> = {
	bigint: 'isBigInt',
	boolean: 'isBoolean',
	function: 'isFunction',
	number: 'isNumber',
	string: 'isString',
	symbol: 'isSymbol',
	undefined: 'isUndefined'
}

type Operation = {call: string; shape: string; node: ESTree.Node; fix?: Parameters<Context['report']>[0]['fix']}
type Shape = (context: Context, node: ESTree.Node) => Operation[]

function operation(call: string, shape: string, node: ESTree.Node, fix?: Operation['fix']) {
	return [{call, fix, node, shape}]
}

function propertyTest(_context: Context, node: ESTree.Node) {
	if (node.type === 'BinaryExpression' && node.operator === 'in' && node.left.type !== 'PrivateIdentifier') {
		return operation('Schema decoding or Predicate.hasProperty', 'an unvalidated property check', node)
	}
	return []
}

// The two halves a concatenation joins: `a + b`, or a template that is only `${a}${b}`.
function halves(node: ESTree.Node) {
	if (node.type === 'BinaryExpression' && node.operator === '+') return Option.some([node.left, node.right])
	if (
		node.type === 'TemplateLiteral' &&
		node.expressions.length === 2 &&
		Array.every(node.quasis, quasi => quasi.value.raw === '')
	) {
		return Option.some(node.expressions)
	}
	return Option.none()
}

function sameText(context: Context, left: ESTree.Node, right: ESTree.Node) {
	return context.sourceCode.getText(left) === context.sourceCode.getText(right)
}

function isNumber(value: number, node?: ESTree.Node) {
	return node?.type === 'Literal' && node.value === value
}

// The string a call applies a String function or a native string method to, with its other arguments: `String.name(...operands)(text)`, `String.name(text, ...operands)` or `text.name(...operands)`.
function stringCall(context: Context, node: ESTree.Node, name: string) {
	if (node.type !== 'CallExpression') return Option.none<{operands: ESTree.Node[]; text: ESTree.Node}>()
	if (
		node.callee.type === 'CallExpression' &&
		node.callee.callee.type !== 'Super' &&
		importedMember({context, importedName: 'String', node: node.callee.callee, propertyName: name})
	) {
		const operands = node.callee.arguments
		return Option.map(Array.head(node.arguments), text => ({operands, text}))
	}
	if (node.callee.type !== 'MemberExpression' || !Option.contains(memberName(node.callee), name)) return Option.none()
	if (importedMember({context, importedName: 'String', node: node.callee})) {
		const operands = Array.drop(node.arguments, 1)
		return Option.map(Array.head(node.arguments), text => ({operands, text}))
	}
	return Option.some({operands: node.arguments, text: node.callee.object})
}

// The first character of a string: `text[0]`, `text.charAt(0)` or `String.slice(0, 1)(text)`, with an optional `?? ''`.
function firstCharacterOf(context: Context, node: ESTree.Node): Option.Option<ESTree.Node> {
	if (node.type === 'LogicalExpression' && node.operator === '??') return firstCharacterOf(context, node.left)
	if (node.type === 'MemberExpression' && node.computed && isNumber(0, node.property)) return Option.some(node.object)
	return pipe(
		stringCall(context, node, 'charAt'),
		Option.filter(call => call.operands.length === 1 && isNumber(0, call.operands[0])),
		Option.orElse(() =>
			pipe(
				stringCall(context, node, 'slice'),
				Option.orElse(() => stringCall(context, node, 'substring')),
				Option.filter(
					call => call.operands.length === 2 && isNumber(0, call.operands[0]) && isNumber(1, call.operands[1])
				)
			)
		),
		Option.map(call => call.text)
	)
}

// The rest of a string after its first character: `String.slice(1)(text)` or `text.slice(1)`.
function restOf(context: Context, node: ESTree.Node) {
	return pipe(
		Option.orElse(stringCall(context, node, 'slice'), () => stringCall(context, node, 'substring')),
		Option.filter(call => call.operands.length === 1 && isNumber(1, call.operands[0])),
		Option.map(call => call.text)
	)
}

// The string whose length a node reads: `text.length` or `String.length(text)`.
function lengthOf(context: Context, node: ESTree.Node) {
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'length')) {
		return Option.some<ESTree.Node>(node.object)
	}
	if (
		node.type === 'CallExpression' &&
		node.callee.type !== 'Super' &&
		importedMember({context, importedName: 'String', node: node.callee, propertyName: 'length'})
	) {
		return Array.head(node.arguments)
	}
	return Option.none()
}

// `String.repeat(width - text.length)(fill)` on one side of the same text.
function padsWith(context: Context, fill: ESTree.Node, text: ESTree.Node) {
	return Option.exists(stringCall(context, fill, 'repeat'), call =>
		Option.exists(
			Array.head(call.operands),
			count =>
				count.type === 'BinaryExpression' &&
				count.operator === '-' &&
				Option.exists(lengthOf(context, count.right), measured => sameText(context, measured, text))
		)
	)
}

function padded(context: Context, node: ESTree.Node) {
	return Option.exists(halves(node), parts =>
		Option.exists(
			Option.all([Array.get(parts, 0), Array.get(parts, 1)]),
			pair => padsWith(context, pair[0], pair[1]) || padsWith(context, pair[1], pair[0])
		)
	)
}

function capitalize(input: {context: Context; fixer: Fixer; node: ESTree.Node; text: ESTree.Node}) {
	return pipe(
		effectImport({context: input.context, fixer: input.fixer, name: 'String', node: input.node}),
		Option.map(imports =>
			Array.append(
				imports,
				input.fixer.replaceText(input.node, `String.capitalize(${input.context.sourceCode.getText(input.text)})`)
			)
		),
		Option.getOrElse(() => [])
	)
}

// `total + amount` or `amount + total`, with `amount` never reading `total`: the amount one step adds.
function addedTo(context: Context, body: ESTree.Node, totalName: string) {
	if (body.type !== 'BinaryExpression' || body.operator !== '+') return Option.none<ESTree.Node>()
	function isTotal(node: ESTree.Node) {
		return node.type === 'Identifier' && node.name === totalName
	}
	return pipe(
		body.right,
		Option.liftPredicate(() => isTotal(body.left)),
		Option.orElse(() => Option.liftPredicate(body.left, () => isTotal(body.right))),
		Option.filter(added => !containsNode({context, matches: isTotal, node: added, throughFunctions: true}))
	)
}

// `(total, item) => total + amount`: one addition per item, which Number.sumAll makes from 0 in the same order; a literal amount counts, which Array.length says.
function summand(context: Context, callback: ESTree.Node) {
	if (callback.type !== 'ArrowFunctionExpression' || callback.params.length !== 2) return Option.none()
	const total = callback.params[0]
	const item = callback.params[1]
	if (total?.type !== 'Identifier' || item?.type !== 'Identifier') return Option.none()
	return pipe(
		addedTo(context, callback.body, total.name),
		Option.filter(added => added.type !== 'Literal'),
		Option.map(added => ({amount: added, item: item.name}))
	)
}

// A holder made with `MutableRef.make(0)`.
function madeFromZero(context: Context, reference: ESTree.IdentifierReference) {
	return Option.exists(
		variableFromScope({name: reference.name, scope: context.sourceCode.getScope(reference)}),
		variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.node.type === 'VariableDeclarator' &&
					definition.node.init?.type === 'CallExpression' &&
					definition.node.init.callee.type !== 'Super' &&
					importedMember({
						context,
						importedName: 'MutableRef',
						node: definition.node.init.callee,
						propertyName: 'make'
					}) &&
					definition.node.init.arguments.length === 1 &&
					isNumber(0, definition.node.init.arguments[0])
			)
	)
}

// What runs a node as its whole body: through its expression statement and a block holding only it.
function holderOf(node: ESTree.Node): ESTree.Node | null {
	if (node.parent?.type === 'ExpressionStatement') return holderOf(node.parent)
	if (node.parent?.type === 'BlockStatement' && node.parent.body.length === 1) return holderOf(node.parent)
	return node.parent
}

// The call is the whole step of a `for…of` loop or of an `Array.forEach` or `forEach` callback.
function isLoopStep(node: ESTree.CallExpression) {
	const holder = holderOf(node)
	if (holder?.type === 'ForOfStatement') return !holder.await
	return (
		Predicate.isNotNullish(holder) &&
		isFunction(holder) &&
		holder.parent?.type === 'CallExpression' &&
		holder.parent.callee.type === 'MemberExpression' &&
		Option.contains(memberName(holder.parent.callee), 'forEach')
	)
}

// `MutableRef.update(total, count => count + amount)` as a loop's whole step, into a holder made from 0: a running total.
function runningTotal(context: Context, value: ESTree.Node) {
	if (value.type !== 'CallExpression') return []
	const node = value
	if (
		node.callee.type === 'Super' ||
		!importedMember({context, importedName: 'MutableRef', node: node.callee, propertyName: 'update'}) ||
		node.arguments.length !== 2
	) {
		return []
	}
	const reference = node.arguments[0]
	const callback = node.arguments[1]
	if (reference?.type !== 'Identifier' || callback?.type !== 'ArrowFunctionExpression') return []
	const total = callback.params[0]
	if (callback.params.length !== 1 || total?.type !== 'Identifier') return []
	if (
		Option.isSome(addedTo(context, callback.body, total.name)) &&
		madeFromZero(context, reference) &&
		isLoopStep(node)
	) {
		return operation('Number.sumAll of mapped amounts, or Array.countBy', 'a running total in a MutableRef', node)
	}
	return []
}

function sum(context: Context, value: ESTree.Node) {
	if (value.type !== 'CallExpression') return []
	const node = value
	if (
		node.callee.type === 'Super' ||
		!importedMember({context, importedName: 'Array', node: node.callee, propertyName: 'reduce'})
	) {
		return []
	}
	if (node.arguments.length < 2 || node.arguments.length > 3) return []
	// The seed and the callback close both forms: `Array.reduce(items, 0, add)` and the curried `Array.reduce(0, add)`.
	const seed = node.arguments[node.arguments.length - 2]
	const callback = node.arguments[node.arguments.length - 1]
	if (!isNumber(0, seed) || Predicate.isUndefined(callback)) return []
	return Option.match(summand(context, callback), {
		onNone: () => [],
		onSome: found => {
			const items = node.arguments[0]
			// A curried step in a pipe has no one-step replacement, so only the data-first form is rewritten.
			if (node.arguments.length === 2 || Predicate.isUndefined(items)) {
				return operation('Number.sumAll of mapped amounts', 'adding them in a reduce from 0', node)
			}
			return operation('Number.sumAll of mapped amounts', 'adding them in a reduce from 0', node, fixer =>
				pipe(
					effectImport({context, fixer, name: 'Number', node}),
					Option.map(imports =>
						Array.append(
							imports,
							fixer.replaceText(
								node,
								`Number.sumAll(Array.map(${context.sourceCode.getText(items)}, ${found.item} => ${context.sourceCode.getText(found.amount)}))`
							)
						)
					),
					Option.getOrElse(() => [])
				)
			)
		}
	})
}

function concatenation(context: Context, node: ESTree.Node) {
	return Option.match(
		pipe(
			halves(node),
			Option.flatMap(parts => Option.all([Array.get(parts, 0), Array.get(parts, 1)])),
			Option.flatMap(pair =>
				pipe(
					stringCall(context, pair[0], 'toUpperCase'),
					Option.filter(call => Array.isArrayEmpty(call.operands)),
					Option.flatMap(call => firstCharacterOf(context, call.text)),
					Option.filter(text => Option.exists(restOf(context, pair[1]), rest => sameText(context, rest, text)))
				)
			)
		),
		{
			onNone: () => {
				if (padded(context, node)) return operation('String.padStart or String.padEnd', 'hand-written padding', node)
				return []
			},
			onSome: text =>
				operation('String.capitalize', 'capitalizing the first character by hand', node, fixer =>
					capitalize({context, fixer, node, text})
				)
		}
	)
}

function emptiness(context: Context, node: ESTree.Node) {
	if (
		node.type !== 'BinaryExpression' ||
		node.left.type !== 'MemberExpression' ||
		!Option.contains(memberName(node.left), 'length') ||
		isFilteredCount({context, node: node.left})
	) {
		return []
	}
	return Option.match(lengthTest(node), {
		onNone: () => [],
		onSome: test => {
			if (test === 'empty') {
				return operation(
					'Array.isArrayEmpty, Array.isReadonlyArrayEmpty or String.isEmpty',
					'comparing a length with zero',
					node
				)
			}
			return operation(
				'Array.isArrayNonEmpty, Array.isReadonlyArrayNonEmpty or String.isNonEmpty',
				'comparing a length with zero',
				node
			)
		}
	})
}

const isSort = matches(/^sort(?:By|With)?$/u)
const isEmptinessTest = matches(/^is(?:Readonly)?Array(?:Non)?Empty$/u)

function intermediate(context: Context, node: ESTree.Node) {
	if (node.type !== 'CallExpression') return []
	return Array.flatMap(composedSteps(context, node), composition => {
		if (composition.inner.module !== 'Array' || composition.outer.module !== 'Array') return []
		if (isSort(composition.inner.name) && Array.contains(['head', 'headNonEmpty'], composition.outer.name)) {
			return operation('Array.min', 'sorting every item to read the first', composition.report)
		}
		if (composition.inner.name !== 'filter') return []
		const first = composition.outer.name === 'head'
		if (!first && !isEmptinessTest(composition.outer.name)) return []
		const name = Boolean.match(first, {onFalse: Function.constant('some'), onTrue: Function.constant('findFirst')})
		const negate = !first && !Array.contains(['isArrayNonEmpty', 'isReadonlyArrayNonEmpty'], composition.outer.name)
		return operation(`Array.${name}`, 'filtering every item when one match is enough', composition.report, fixer => {
			if (negate && !composition.nested) return []
			return Option.match(composition.inner.call, {
				onNone: () => [],
				onSome: call => [
					fixer.replaceTextRange(
						[composition.start, composition.end],
						`${Boolean.match(negate, {onFalse: Function.constant(''), onTrue: Function.constant('!')})}Array.${name}(${argumentsText(context, call)})`
					)
				]
			})
		})
	})
}

function collectionRead(context: Context, node: ESTree.Node) {
	if (node.type !== 'MemberExpression') return []
	if (isFilteredCount({context, node})) {
		if (
			node.parent.type === 'BinaryExpression' &&
			node.parent.left === node &&
			Option.isSome(lengthTest(node.parent))
		) {
			return operation('Array.some', 'building a filtered array that is not consumed', node)
		}
		return operation('Array.countBy', 'building a filtered array that is not consumed', node)
	}
	if (
		!node.computed ||
		!isNumber(0, node.property) ||
		node.object.type !== 'CallExpression' ||
		node.object.callee.type !== 'MemberExpression' ||
		!importedMember({context, importedName: 'Array', node: node.object.callee})
	) {
		return []
	}
	const name = memberName(node.object.callee)
	if (Option.contains(name, 'filter')) {
		return operation('Array.findFirst', 'filtering every item to read the first', node)
	}
	if (Option.exists(name, isSort)) return operation('Array.min', 'sorting every item to read the first', node)
	return []
}

function optionCheck(context: Context, test: ESTree.Node, text: string, some: boolean): boolean {
	const variant = Boolean.match(some, {
		onFalse: () => ({name: 'isNone', operator: '||'}),
		onTrue: () => ({name: 'isSome', operator: '&&'})
	})
	if (test.type === 'LogicalExpression' && test.operator === variant.operator) {
		return optionCheck(context, test.left, text, some) || optionCheck(context, test.right, text, some)
	}
	return (
		test.type === 'CallExpression' &&
		importedMember({context, importedName: 'Option', node: test.callee, propertyName: variant.name}) &&
		test.arguments[0] !== undefined &&
		context.sourceCode.getText(test.arguments[0]) === text
	)
}

function exits(node: ESTree.Statement): boolean {
	return (
		Array.contains(['ContinueStatement', 'ReturnStatement', 'ThrowStatement'], node.type) ||
		(node.type === 'BlockStatement' && Array.some(node.body, exits))
	)
}

function earlyExit(context: Context, node: ESTree.Node, text: string) {
	if (node.parent?.type !== 'BlockStatement' && node.parent?.type !== 'Program') return false
	return pipe(
		node.parent.body,
		Array.takeWhile(statement => statement !== node),
		Array.some(
			statement =>
				statement.type === 'IfStatement' &&
				exits(statement.consequent) &&
				optionCheck(context, statement.test, text, false)
		)
	)
}

function guardedOption(context: Context, node: ESTree.Node, text: string): boolean {
	if (node.parent === null || node.parent.type === 'FunctionDeclaration') return false
	return (
		((node.parent.type === 'IfStatement' || node.parent.type === 'ConditionalExpression') &&
			node.parent.consequent === node &&
			optionCheck(context, node.parent.test, text, true)) ||
		(node.parent.type === 'LogicalExpression' &&
			node.parent.right === node &&
			((node.parent.operator === '&&' && optionCheck(context, node.parent.left, text, true)) ||
				(node.parent.operator === '||' && optionCheck(context, node.parent.left, text, false)))) ||
		earlyExit(context, node, text) ||
		guardedOption(context, node.parent, text)
	)
}

function optionRead(context: Context, node: ESTree.Node) {
	if (
		node.type === 'MemberExpression' &&
		Option.contains(memberName(node), 'value') &&
		guardedOption(context, node, context.sourceCode.getText(node.object))
	) {
		return operation('Option.match, Option.map or Option.getOrElse', 'reading .value after a guard', node)
	}
	return []
}

const GUARD_SHAPES: Record<string, string> = {
	'!= null': 'isNotNullish',
	'!== null': 'isNotNull',
	'!== null && !Array.isArray && typeof === object': 'isObject',
	'!== null && typeof === object': 'isObjectOrArray',
	'!== undefined': 'isNotUndefined',
	'== null': 'isNullish',
	'=== null': 'isNull',
	'=== undefined': 'isUndefined',
	'instanceof Date': 'isDate',
	'instanceof Error': 'isError',
	'instanceof Map': 'isMap',
	'instanceof RegExp': 'isRegExp',
	'instanceof Set': 'isSet',
	'instanceof Uint8Array': 'isUint8Array',
	...Record.mapKeys(GUARDS, name => `typeof === ${name}`)
}

function subject(node: ESTree.Node, name: string) {
	return node.type === 'Identifier' && node.name === name
}

function comparison(subjectNode: ESTree.Node, other: ESTree.Node, operator: string, name: string) {
	if (
		subjectNode.type === 'UnaryExpression' &&
		subjectNode.operator === 'typeof' &&
		subject(subjectNode.argument, name) &&
		other.type === 'Literal' &&
		Predicate.isString(other.value)
	) {
		return Option.some(`typeof ${operator} ${other.value}`)
	}
	if (!subject(subjectNode, name)) return Option.none()
	if (other.type === 'Literal' && other.raw === 'null') return Option.some(`${operator} null`)
	if (subject(other, 'undefined')) return Option.some(`${operator} undefined`)
	return Option.none()
}

function guardParts(node: ESTree.Expression, name: string): Option.Option<string[]> {
	if (node.type === 'LogicalExpression' && node.operator === '&&') {
		return Option.map(Option.all([guardParts(node.left, name), guardParts(node.right, name)]), Array.flatten)
	}
	if (
		node.type === 'UnaryExpression' &&
		node.operator === '!' &&
		node.argument.type === 'CallExpression' &&
		node.argument.callee.type === 'MemberExpression' &&
		subject(node.argument.callee.object, 'Array') &&
		Option.contains(memberName(node.argument.callee), 'isArray') &&
		node.argument.arguments.length === 1 &&
		Array.every(node.argument.arguments, argument => subject(argument, name))
	) {
		return Option.some(['!Array.isArray'])
	}
	if (node.type !== 'BinaryExpression') return Option.none()
	if (node.operator === 'instanceof') {
		if (subject(node.left, name) && node.right.type === 'Identifier') {
			return Option.some([`instanceof ${node.right.name}`])
		}
		return Option.none()
	}
	return pipe(
		comparison(node.left, node.right, node.operator, name),
		Option.orElse(() => comparison(node.right, node.left, node.operator, name)),
		Option.map(Array.of)
	)
}

function replaceableGuard(node: ESTree.Node) {
	if (
		node.type !== 'ArrowFunctionExpression' &&
		node.type !== 'FunctionDeclaration' &&
		node.type !== 'FunctionExpression'
	) {
		return Option.none<string>()
	}
	const predicate = node.returnType?.typeAnnotation
	const returned = returnedExpression(node)
	if (
		predicate?.type !== 'TSTypePredicate' ||
		predicate.asserts ||
		predicate.parameterName.type !== 'Identifier' ||
		Predicate.isNullish(returned)
	) {
		return Option.none<string>()
	}
	return pipe(
		guardParts(returned, predicate.parameterName.name),
		Option.map(parts => pipe(parts, Array.sort(String.Order), Array.join(' && '))),
		Option.flatMap(key => Record.get(GUARD_SHAPES, key))
	)
}

function enclosingGuard(node: ESTree.Node): boolean {
	if (isFunction(node)) return Option.isSome(replaceableGuard(node))
	return node.parent !== null && enclosingGuard(node.parent)
}

function typeGuard(_context: Context, node: ESTree.Node) {
	return Option.match(replaceableGuard(node), {
		onNone: () => [],
		onSome: name => operation(`Predicate.${name}`, 'a hand-written type guard', node)
	})
}

function ambient(node: ESTree.Node): boolean {
	return (
		(Predicate.hasProperty(node, 'declare') && node.declare) ||
		node.type === 'TSDeclareFunction' ||
		(node.parent !== null && ambient(node.parent))
	)
}

function typeTest(context: Context, node: ESTree.Node) {
	if (node.type !== 'UnaryExpression' || node.operator !== 'typeof' || enclosingGuard(node)) return []
	if (
		node.argument.type === 'Identifier' &&
		!Option.exists(variableOf(context, node.argument), variable => Array.isArrayNonEmpty(variable.defs))
	) {
		return []
	}
	return operation(
		'the corresponding Predicate guard (isString, isNumber, isBoolean, isFunction, isObject or isUndefined)',
		'typeof',
		node,
		fixer => {
			if (
				node.argument.type !== 'Identifier' ||
				Option.exists(variableOf(context, node.argument), variable =>
					Array.some(variable.defs, definition => ambient(definition.node))
				) ||
				node.parent.type !== 'BinaryExpression' ||
				node.parent.left !== node ||
				(node.parent.operator !== '===' && node.parent.operator !== '!==') ||
				node.parent.right.type !== 'Literal' ||
				!Predicate.isString(node.parent.right.value)
			) {
				return []
			}
			const guard = GUARDS[node.parent.right.value]
			if (guard === undefined) return []
			const negation = Boolean.match(node.parent.operator === '!==', {
				onFalse: Function.constant(''),
				onTrue: Function.constant('!')
			})
			const argument = node.argument.name
			return Option.match(effectImport({context, fixer, name: 'Predicate', node}), {
				onNone: () => [],
				onSome: imports =>
					Array.append(imports, fixer.replaceText(node.parent, `${negation}Predicate.${guard}(${argument})`))
			})
		}
	)
}

function nullishOperand(context: Context, node: ESTree.Expression) {
	if (node.type === 'Literal' && node.value === null) return Option.some('null')
	if (
		subject(node, 'undefined') &&
		node.type === 'Identifier' &&
		!Option.exists(variableOf(context, node), variable => Array.isArrayNonEmpty(variable.defs))
	) {
		return Option.some('undefined')
	}
	return Option.none<string>()
}

function logicalOperands(node: ESTree.Expression, operator: string): ESTree.Expression[] {
	if (node.type === 'LogicalExpression' && node.operator === operator) {
		return Array.appendAll(logicalOperands(node.left, operator), logicalOperands(node.right, operator))
	}
	return [node]
}

type NullishCheck = {node: ESTree.Node; nullish: string; subject: ESTree.Node}
function nullish(context: Context, node: ESTree.Node) {
	if (
		node.type !== 'LogicalExpression' ||
		node.operator === '??' ||
		enclosingGuard(node) ||
		(node.parent.type === 'LogicalExpression' && node.parent.operator === node.operator)
	) {
		return []
	}
	const operator = Boolean.match(node.operator === '&&', {
		onFalse: Function.constant('==='),
		onTrue: Function.constant('!==')
	})
	const checks = Array.flatMap(logicalOperands(node, node.operator), operand => {
		if (
			operand.type === 'BinaryExpression' &&
			operand.operator === operator &&
			operand.left.type !== 'PrivateIdentifier'
		) {
			return Option.toArray(
				Option.map(nullishOperand(context, operand.right), missing => ({
					node: operand,
					nullish: missing,
					subject: operand.left
				}))
			)
		}
		return []
	})
	function doubled(first: NullishCheck, second: NullishCheck) {
		return sameText(context, first.subject, second.subject) && first.nullish !== second.nullish
	}
	if (!Array.some(checks, first => Array.some(checks, second => doubled(first, second)))) return []
	const guard = Boolean.match(node.operator === '&&', {
		onFalse: Function.constant('isNullish'),
		onTrue: Function.constant('isNotNullish')
	})
	return operation(`Predicate.${guard}`, 'testing null and undefined separately', node, fixer =>
		pipe(
			Array.zip(checks, Array.drop(checks, 1)),
			Array.findFirst(pair => {
				if (
					pair[0].subject.type !== 'Identifier' ||
					!doubled(pair[0], pair[1]) ||
					context.sourceCode.getTokensBetween(pair[0].node, pair[1].node).length !== 1
				) {
					return Option.none()
				}
				return Option.map(effectImport({context, fixer, name: 'Predicate', node}), imports =>
					Array.append(
						imports,
						fixer.replaceTextRange(
							[pair[0].node.range[0], pair[1].node.range[1]],
							`Predicate.${guard}(${context.sourceCode.getText(pair[0].subject)})`
						)
					)
				)
			}),
			Option.getOrElse(() => [])
		)
	)
}

function maximum(context: Context, node: ESTree.Node) {
	if (
		node.type !== 'CallExpression' ||
		node.callee.type === 'Super' ||
		!importedMember({context, importedName: 'Array', node: node.callee, propertyName: 'reduce'})
	) {
		return []
	}
	const callback = Array.last(node.arguments)
	if (!Option.exists(callback, isFunction)) return []
	return Option.match(callback, {
		onNone: () => [],
		onSome: fn => {
			if (
				fn.type !== 'ArrowFunctionExpression' &&
				fn.type !== 'FunctionExpression' &&
				fn.type !== 'FunctionDeclaration'
			) {
				return []
			}
			const body = returnedExpression(fn)
			if (
				body?.type !== 'CallExpression' ||
				body.callee.type !== 'MemberExpression' ||
				!Option.contains(memberName(body.callee), 'max') ||
				body.arguments.length !== 2 ||
				fn.params.length !== 2 ||
				!Array.every(fn.params, parameter => parameter.type === 'Identifier')
			) {
				return []
			}
			if (
				!(
					(body.callee.object.type === 'Identifier' && body.callee.object.name === 'Math') ||
					importedMember({context, importedName: 'Number', node: body.callee})
				)
			) {
				return []
			}
			if (
				!Array.every(fn.params, parameter =>
					Array.some(body.arguments, argument => sameText(context, parameter, argument))
				)
			) {
				return []
			}
			return operation(
				'pipe(items, Array.prepend(seed), Array.max(Order.Number)) for finite numbers',
				'a maximum by hand',
				node
			)
		}
	})
}

function ownCalls(context: Context, node: ESTree.Node): ESTree.CallExpression[] {
	if (isFunction(node)) return []
	const children = Array.flatMap(childNodes(context, node), child => ownCalls(context, child))
	if (node.type === 'CallExpression') return Array.prepend(children, node)
	return children
}

function enclosingBody(node: ESTree.Node): ESTree.Node {
	if (node.parent === null || isFunction(node.parent)) return node
	return enclosingBody(node.parent)
}

function filterParts(context: Context, node: ESTree.CallExpression) {
	if (
		node.callee.type === 'Super' ||
		!importedMember({context, importedName: 'Array', node: node.callee, propertyName: 'filter'})
	) {
		return Option.none()
	}
	if (node.arguments.length === 2) return Option.some({items: node.arguments[0], predicate: node.arguments[1]})
	if (
		node.arguments.length === 1 &&
		node.parent.type === 'CallExpression' &&
		node.parent.callee.type === 'Identifier' &&
		node.parent.callee.name === 'pipe' &&
		node.parent.arguments[1] === node
	) {
		return Option.some({items: node.parent.arguments[0], predicate: node.arguments[0]})
	}
	return Option.none()
}

function predicateBodyText(context: Context, callback: ESTree.Node, expression: ESTree.Node) {
	if (
		callback.type === 'ArrowFunctionExpression' &&
		callback.params[0]?.type === 'Identifier' &&
		expression.type === 'CallExpression' &&
		expression.callee.type === 'CallExpression' &&
		expression.arguments.length === 1 &&
		expression.arguments[0] !== undefined &&
		subject(expression.arguments[0], callback.params[0].name)
	) {
		return context.sourceCode.getText(expression.callee)
	}
	return context.sourceCode.getText(expression)
}

function predicatePolarity(context: Context, callback: ESTree.Node, expression: ESTree.Node) {
	if (expression.type === 'UnaryExpression' && expression.operator === '!') {
		return {negative: true, text: predicateBodyText(context, callback, expression.argument)}
	}
	return {negative: false, text: predicateBodyText(context, callback, expression)}
}

function predicateText(context: Context, node: ESTree.Node) {
	if (node.type === 'ArrowFunctionExpression') return predicatePolarity(context, node, node.body)
	return predicatePolarity(context, node, node)
}

function oppositeFilters(context: Context, node: ESTree.Node) {
	if (node.type !== 'CallExpression') return []
	return Option.match(filterParts(context, node), {
		onNone: () => [],
		onSome: current => {
			const items = current.items
			if (items === undefined || current.predicate === undefined) return []
			const predicate = predicateText(context, current.predicate)
			const opposite = Array.some(ownCalls(context, enclosingBody(node)), other => {
				if (other.range[0] >= node.range[0]) return false
				return Option.exists(
					filterParts(context, other),
					found =>
						found.items !== undefined &&
						found.predicate !== undefined &&
						sameText(context, items, found.items) &&
						predicateText(context, found.predicate).text === predicate.text &&
						predicateText(context, found.predicate).negative !== predicate.negative
				)
			})
			if (opposite) {
				return operation(
					'Array.partition(items, Filter.fromPredicate(predicate)) and read its [passes, failures] pair',
					'two opposite filters over the same items',
					node
				)
			}
			return []
		}
	})
}

function unaryEntryMapper(context: Context, node: ESTree.CallExpression) {
	return (
		importedMember({context, importedName: 'Array', node: node.callee, propertyName: 'map'}) &&
		Option.exists(
			Array.last(node.arguments),
			callback =>
				callback.type === 'ArrowFunctionExpression' &&
				callback.params.length <= 1 &&
				Array.every(callback.params, parameter => parameter.type !== 'RestElement')
		)
	)
}

function iterableRecord(context: Context, node: ESTree.Node) {
	if (
		node.type !== 'CallExpression' ||
		!importedMember({context, importedName: 'Record', node: node.callee, propertyName: 'fromEntries'})
	) {
		return []
	}
	const input = node.arguments[0]
	if (input?.type !== 'CallExpression') return []
	if (unaryEntryMapper(context, input) && input.arguments.length === 2) {
		return operation('Record.fromIterableWith', 'mapping entries before building a record', node, fixer =>
			fixer.replaceText(node, `Record.fromIterableWith(${argumentsText(context, input)})`)
		)
	}
	if (input.callee.type !== 'Identifier' || input.callee.name !== 'pipe') return []
	const last = Array.last(input.arguments)
	if (
		!Option.isSome(last) ||
		last.value.type !== 'CallExpression' ||
		last.value.arguments.length !== 1 ||
		!unaryEntryMapper(context, last.value)
	) {
		return []
	}
	const mapper = last.value
	return operation('Record.fromIterableWith', 'mapping entries before building a record', node, fixer => [
		fixer.removeRange([node.range[0], input.range[0]]),
		fixer.replaceText(mapper.callee, 'Record.fromIterableWith'),
		fixer.removeRange([input.range[1], node.range[1]])
	])
}

// The first matching shape owns the expression, including its smaller spellings.
const SHAPES: Record<string, Shape[]> = {
	ArrowFunctionExpression: [typeGuard],
	BinaryExpression: [propertyTest, concatenation, emptiness],
	CallExpression: [iterableRecord, sum, runningTotal, intermediate, maximum, oppositeFilters],
	FunctionDeclaration: [typeGuard],
	FunctionExpression: [typeGuard],
	LogicalExpression: [nullish],
	MemberExpression: [collectionRead, optionRead],
	TemplateLiteral: [concatenation],
	UnaryExpression: [typeTest]
}

export const libraryOperation = defineRule({
	create: context =>
		Record.map(SHAPES, shapes => (node: ESTree.Node) => {
			pipe(
				shapes,
				Array.findFirst(shape => Array.head(shape(context, node))),
				Option.map(match =>
					context.report({fix: match.fix, message: `Use ${match.call} instead of ${match.shape}.`, node: match.node})
				)
			)
		}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Array, Record} from 'effect'
export function indexed(items: readonly {name: string}[]) { return Record.fromEntries(Array.map(items, (item, index) => [item.name, index])) }
export function rest(items: readonly {name: string}[]) { return Record.fromEntries(Array.map(items, (...args: [{name: string}, number]) => [args[0].name, args[1]])) }`
					},
					{
						'sample.ts': `import {Array, Filter, Order, Predicate, String, pipe} from 'effect'
export function splitNotes(notes: readonly {pinned: boolean}[]) { return Array.partition(notes, Filter.fromPredicate(note => note.pinned)) }
export function maximumOf(values: readonly number[], floor: number) { return pipe(values, Array.prepend(floor), Array.max(Order.Number)) }
export function firstPinned(notes: readonly {pinned: boolean}[]) { return Array.findFirst(notes, note => note.pinned) }
export const isEmpty = Array.isReadonlyArrayEmpty
export function describeValue(value: unknown) { return {isMissing: Predicate.isNullish(value), isText: Predicate.isString(value), value} }
export function titleOf(text: string) { return pipe(text, String.capitalize, String.padEnd(8, ' ')) }`
					},
					{
						'sample.ts': `import {Function, Option} from 'effect'
export function selectedTitle(title: Option.Option<string>) { return Option.getOrElse(title, Function.constNull) }`
					},
					{
						'sample.ts': `import {Array, Number, pipe} from 'effect'
export function totalAmount(notes: readonly {amount: number}[]) { return pipe(notes, Array.map(note => note.amount), Number.sumAll) }`
					}
				],
				fixes: [
					{
						'sample.ts': `import {Array, Record, String, pipe} from 'effect'
export function indexed(items: readonly {name: string}[]) { return Record.fromEntries(Array.map(items, item => [item.name, item])) }
export function named(items: readonly {name: string}[]) { return Record.fromEntries(pipe(items, Array.filter(item => String.isNonEmpty(item.name)), Array.map(item => [item.name, item.name]))) }`
					},
					{
						'sample.ts': `export function describeValue(value: unknown) { return {isMissing: value === null || value === undefined, isText: typeof value === 'string', value} }`
					},
					{
						'sample.ts': `import {Array} from 'effect'
export function firstPinned(notes: readonly {pinned: boolean}[]) { return Array.head(Array.filter(notes, note => note.pinned)) }
export function hasPinned(notes: readonly {pinned: boolean}[]) { return Array.isReadonlyArrayNonEmpty(Array.filter(notes, note => note.pinned)) }`
					},
					{
						'sample.ts': `import {Array} from 'effect'
export function totalAmount(notes: readonly {amount: number}[]) { return Array.reduce(notes, 0, (total, note) => total + note.amount) }`
					},
					{
						'sample.ts': `import {String} from 'effect'
export function titleOf(text: string) { return String.toUpperCase(String.slice(0, 1)(text)) + String.slice(1)(text) }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
