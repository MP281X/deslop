import {Array, Boolean, Function, HashSet, Option, Order, Predicate, Record, Result, String, pipe} from 'effect'

import type {ImportDeclaration, ImportDeclarationSpecifier} from 'oxc-parser'
import {parseSync, visitorKeys} from 'oxc-parser'

import {matches} from '#lib/ast.ts'
import {JUDGE_DIRECTIVE, JUDGE_IGNORE} from '#lib/question.ts'
import type {Kind} from '#lib/question.ts'

const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']

// The text of a comment line after its `//`.
function commentValue(line: string) {
	return String.replace(/^\s*\/\//u, '')(line)
}

// A unit with only the imports it uses, so an import added for another unit asks nothing again; `names` are the imported bindings it uses, its text opens with the comments right above it, and `ignores` maps each question its `judge-ignore` comments opt out of to the reason given.
export type Unit = {
	composition: boolean
	end: number
	ignores: Record<string, string>
	imports: string
	kind: Kind
	line: number
	names: string[]
	start: number
	text: string
}

type Node = {type: string; start: number; end: number}

function isNode(value: unknown): value is Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

function field(node: unknown, key: string) {
	if (!Predicate.hasProperty(node, key)) return Option.none()
	return Option.some(node[key])
}

function isMethod(node: Node) {
	if (node.type === 'MethodDefinition') return true
	return (
		node.type === 'Property' &&
		(Option.exists(field(node, 'method'), method => method === true) ||
			Option.exists(field(node, 'kind'), kind => kind === 'get' || kind === 'set'))
	)
}

function nodeAt(node: Node, key: string) {
	return Option.filter(field(node, key), isNode)
}

function textOf(source: string, node: Node) {
	return String.slice(node.start, node.end)(source)
}

function callPath(node: Node): string[] {
	if (node.type === 'Identifier') return Option.toArray(Option.filter(field(node, 'name'), Predicate.isString))
	if (node.type === 'CallExpression') return Option.match(nodeAt(node, 'callee'), {onNone: () => [], onSome: callPath})
	if (node.type === 'TaggedTemplateExpression') {
		return Option.match(nodeAt(node, 'tag'), {onNone: () => [], onSome: callPath})
	}
	if (node.type !== 'MemberExpression') return []
	return [
		...Option.match(nodeAt(node, 'object'), {onNone: () => [], onSome: callPath}),
		...Option.toArray(
			pipe(
				nodeAt(node, 'property'),
				Option.flatMap(property => field(property, 'name')),
				Option.filter(Predicate.isString)
			)
		)
	]
}

// Composition callbacks register independent handlers. Nested business functions are still jobs, not composition.
function composition(ancestors: Node[], imported: Record<string, string>) {
	return Array.some(ancestors, (node, index) => {
		if (node.type !== 'CallExpression') return false
		const chain = callPath(node)
		const inside = Array.drop(ancestors, index + 1)
		const functions = Array.countBy(inside, ancestor => Array.contains(FUNCTIONS, ancestor.type))
		if (
			Array.join(chain, '.') === 'defineRule' &&
			pipe(
				imported,
				Record.get('defineRule'),
				Option.exists(matches(/^import \{defineRule\} from ['"]vite-plus\/lint\/plugins['"]$/u))
			)
		) {
			const create = Array.findFirstIndex(
				inside,
				ancestor =>
					ancestor.type === 'Property' &&
					Option.exists(nodeAt(ancestor, 'key'), key => Option.contains(field(key, 'name'), 'create'))
			)
			return (
				functions <= 1 &&
				Option.exists(Array.last(ancestors), parent => parent.type === 'Property') &&
				Option.exists(create, at =>
					pipe(
						inside,
						Array.drop(at + 1),
						Array.every(ancestor =>
							Array.contains(
								[
									...FUNCTIONS,
									'BlockStatement',
									'ReturnStatement',
									'ObjectExpression',
									'ParenthesizedExpression',
									'Property'
								],
								ancestor.type
							)
						)
					)
				)
			)
		}
		if (
			Array.join(chain, '.') === 'HttpRouter.use' &&
			pipe(
				imported,
				Record.get('HttpRouter'),
				Option.exists(matches(/^import \{HttpRouter\} from ['"]effect\/http['"]$/u))
			)
		) {
			return functions <= 1
		}
		return (
			functions === 0 &&
			chain[0] === 'Layer' &&
			Array.contains(['effect', 'unwrap'], chain[1] ?? '') &&
			pipe(imported, Record.get('Layer'), Option.exists(matches(/^import \{Layer\} from ['"]effect['"]$/u)))
		)
	})
}

function isTestCall(node: Node, bindings: HashSet.HashSet<string>) {
	if (node.type !== 'CallExpression') return false
	const chain = callPath(node)
	return (
		HashSet.has(bindings, chain[0] ?? '') &&
		!Array.contains(chain, 'layer') &&
		Array.countBy(Array.ensure(Option.getOrUndefined(field(node, 'arguments'))), isNode) >= 2
	)
}

function nameOf(node: Node, parent: Option.Option<Node>) {
	return pipe(
		Option.orElse(nodeAt(node, 'id'), () =>
			pipe(
				parent,
				Option.filter(found => found.type === 'VariableDeclarator'),
				Option.flatMap(found => nodeAt(found, 'id'))
			)
		),
		Option.flatMap(identifier => field(identifier, 'name')),
		Option.filter(Predicate.isString)
	)
}

function importLine(source: string, declaration: ImportDeclaration, specifier: ImportDeclarationSpecifier) {
	const binding = textOf(source, specifier)
	const kind = Boolean.match(declaration.importKind === 'type', {
		onFalse: Function.constant(''),
		onTrue: Function.constant('type ')
	})
	if (specifier.type === 'ImportSpecifier') {
		return `import ${kind}{${binding}} from ${textOf(source, declaration.source)}`
	}
	return `import ${kind}${binding} from ${textOf(source, declaration.source)}`
}

function childrenOf(node: Node) {
	return Array.flatMap(visitorKeys[node.type] ?? [], key =>
		Array.filter(Array.ensure(Option.getOrUndefined(field(node, key))), isNode)
	)
}

// Every identifier in the unit's code, never a word in its strings or comments.
function identifiers(node: Node): string[] {
	return [
		...Option.toArray(
			pipe(
				field(node, 'name'),
				Option.filter(Predicate.isString),
				Option.filter(() => matches(/Identifier$/u)(node.type))
			)
		),
		...Array.flatMap(childrenOf(node), identifiers)
	]
}

function importsOf(source: string, program: ReturnType<typeof parseSync>['program']) {
	return Record.fromEntries(
		Array.flatMap(program.body, statement => {
			if (statement.type !== 'ImportDeclaration') return []
			return Array.map(
				statement.specifiers,
				specifier => [specifier.local.name, importLine(source, statement, specifier)] as const
			)
		})
	)
}

// Each imported binding of a file and its import line, so a unit's imports can be compared with the file's before the change.
export function importLines(filename: string, source: string) {
	return importsOf(source, parseSync(filename, source).program)
}

// The number of `starts` at or before `offset`, by halving the sorted run between `low` and `high`.
function countUpTo(starts: number[], offset: number, low: number, high: number): number {
	if (low >= high) return low
	const middle = low + Math.floor((high - low) / 2)
	if (
		pipe(
			starts,
			Array.get(middle),
			Option.exists(start => start <= offset)
		)
	) {
		return countUpTo(starts, offset, middle + 1, high)
	}
	return countUpTo(starts, offset, low, middle)
}

// The pieces of a file worth judging alone, outermost first so none holds another: test cases in test files, then functions of a bounded size.
function units(
	filename: string,
	source: string,
	parsed: ReturnType<typeof parseSync>,
	imported: Record<string, string>,
	shortest: number
) {
	const lines = String.split(source, '\n')
	const starts = Array.scan(lines, 0, (offset, line) => offset + line.length + 1)
	function lineOf(offset: number) {
		return countUpTo(starts, offset, 0, starts.length)
	}
	// The lines that hold only a `//` comment, by the parser's own reading, so a string or template that quotes one is code.
	const commentLines = HashSet.fromIterable(
		Array.flatMap(parsed.comments, comment => {
			const line = lineOf(comment.start)
			if (comment.type !== 'Line' || !matches(/^\s*$/u)(String.slice(starts[line - 1] ?? 0, comment.start)(source))) {
				return []
			}
			return [line]
		})
	)
	function unit(kind: Kind, node: Node, line: number, ancestors: Node[]) {
		// The opt-outs sit in the comment lines right above the unit, beside any explanation the model reads with the code.
		const above = pipe(
			Array.unfold(line - 1, number =>
				Option.liftPredicate([number, number - 1] as const, () => HashSet.has(commentLines, number))
			),
			Array.reverse,
			Array.map(number => String.trimStart(lines[number - 1] ?? ''))
		)
		const names = Array.filter(Array.dedupe(identifiers(node)), name => Record.has(imported, name))
		return {
			composition: composition(ancestors, imported),
			end: lineOf(node.end),
			ignores: Record.fromEntries(
				Array.flatMap(above, comment =>
					Option.toArray(
						Option.map(
							String.match(JUDGE_IGNORE)(commentValue(comment)),
							found => [found[1] ?? '', found[2] ?? ''] as const
						)
					)
				)
			),
			imports: pipe(
				Record.toEntries(imported),
				Array.filter(entry => Array.contains(names, entry[0])),
				Array.map(entry => entry[1]),
				Array.join('\n')
			),
			kind,
			line,
			names,
			start: line - above.length,
			text: Array.join(
				[...Array.filter(above, comment => !matches(JUDGE_DIRECTIVE)(commentValue(comment))), textOf(source, node)],
				'\n'
			)
		}
	}
	const tests = matches(/\.test\.[cm]?[jt]sx?$/u)(filename)
	const tsx = String.endsWith('.tsx')(filename)
	const importedTests = Array.flatMap(parsed.program.body, statement => {
		if (
			statement.type !== 'ImportDeclaration' ||
			!Array.contains(['@effect/vitest', 'vitest'], statement.source.value)
		) {
			return []
		}
		return Array.flatMap(statement.specifiers, specifier => {
			if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') return []
			return [{imported: specifier.imported.name, local: specifier.local.name}]
		})
	})
	const registrations = HashSet.fromIterable([
		'it',
		'test',
		...pipe(
			importedTests,
			Array.filter(binding => Array.contains(['it', 'test', 'effect', 'live', 'prop'], binding.imported)),
			Array.map(binding => binding.local)
		)
	])
	const containers = HashSet.fromIterable([
		'layer',
		'describeWrapped',
		...pipe(
			importedTests,
			Array.filter(binding => Array.contains(['layer', 'describeWrapped'], binding.imported)),
			Array.map(binding => binding.local)
		)
	])
	function visit(
		node: Node,
		parent: Option.Option<Node>,
		bindings: HashSet.HashSet<string>,
		ancestors: Node[]
	): Unit[] {
		const line = lineOf(node.start)
		const length = lineOf(node.end) - line + 1
		if (tests && isTestCall(node, bindings)) return [unit('test', node, line, ancestors)]
		const chain = callPath(node)
		const layered =
			tests &&
			node.type === 'CallExpression' &&
			((Array.contains(chain, 'layer') && HashSet.has(bindings, chain[0] ?? '')) ||
				HashSet.has(containers, chain[0] ?? ''))
		function next(child: Node) {
			const parameters = Boolean.match(layered && Array.contains(FUNCTIONS, child.type), {
				onFalse: () => [],
				onTrue: () =>
					pipe(
						field(child, 'params'),
						Option.getOrUndefined,
						Array.ensure,
						Array.filter(isNode),
						Array.flatMap(parameter => Option.toArray(Option.filter(field(parameter, 'name'), Predicate.isString)))
					)
			})
			return visit(child, Option.some(node), HashSet.union(bindings, HashSet.fromIterable(parameters)), [
				...ancestors,
				node
			])
		}
		const nested = Boolean.match(tests, {onFalse: () => [], onTrue: () => Array.flatMap(childrenOf(node), next)})
		if (Array.some(nested, found => found.kind === 'test')) return nested
		if (Array.contains(FUNCTIONS, node.type) && length <= 150) {
			if (length < shortest) return []
			// A method's function starts at its parameters, so the unit is the whole method: its name, `async`, `*`, `static` and accessor kind belong to what it does.
			const span = pipe(parent, Option.filter(isMethod), Option.getOrElse(Function.constant(node)))
			return [
				unit(
					Boolean.match(tsx && Option.exists(nameOf(node, parent), matches(/^[A-Z]/u)), {
						onFalse: Function.constant('code'),
						onTrue: Function.constant('component')
					}),
					span,
					lineOf(span.start),
					ancestors
				)
			]
		}
		if (tests) return nested
		return Array.flatMap(childrenOf(node), next)
	}
	const selected = visit(parsed.program, Option.none(), registrations, [])
	return {
		unattached: pipe(
			Array.fromIterable(commentLines),
			Array.filter(line => matches(JUDGE_DIRECTIVE)(commentValue(lines[line - 1] ?? ''))),
			Array.filter(line => !Array.some(selected, found => line >= found.start && line < found.line)),
			Array.sort(Order.Number)
		),
		units: selected
	}
}

function parsedUnits(filename: string, source: string, shortest: number) {
	const parsed = parseSync(filename, source)
	return Option.match(Array.head(parsed.errors), {
		onNone: () => {
			const imported = importsOf(source, parsed.program)
			return Result.succeed({imports: imported, ...units(filename, source, parsed, imported, shortest)})
		},
		onSome: error => Result.fail(error.message)
	})
}

// A file read once: why the parser cannot read it, such as a syntax error or a NUL byte, since its units would be partial; else its import lines and units. A function of a few lines holds too little to judge.
export function readSource(filename: string, source: string) {
	return parsedUnits(filename, source, 6)
}

// A question's example is short on purpose, so only its shape, not its length, has to be one the judge selects.
export function readExample(filename: string, source: string) {
	return parsedUnits(filename, source, 1)
}
