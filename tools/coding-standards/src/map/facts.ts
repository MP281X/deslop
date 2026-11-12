import {Array, Boolean, Number, Option, Predicate, Record, String, pipe} from 'effect'

import {parseSync} from 'oxc-parser'

import {matches} from '#lib/ast.ts'
import type {Node} from '#lib/nodes.ts'
import {childrenOf, field, nodeAt, nodesAt, textOf} from '#lib/nodes.ts'

// A top-level declaration with every name its code reads, so a schema's shape can follow the schemas it holds.
export type Declaration = {name: string; names: string[]; text: string}

// A service class or a layer built at the top level, with the services its code yields and the ones whose `.layer` it builds or provides.
export type Provider = {
	libraries: string[]
	name: string
	parts: string[]
	service: boolean
	text: string
	yields: string[]
}

// A top-level statement other than an import, with the comments above it, so an edited or moved declaration is found by its text; `key` names a declaration apart from the type of the same name.
export type Statement = {exported: boolean; key: string; lines: string[]; text: string}

export type Contract = {kind: 'rpc' | 'tool'; name: string; names: string[]; text: string}

type Located = Declaration & {node: Node}

type LockState = {importer: string; name: string; section: string}

function nameOf(node: Node) {
	return Option.filter(field(node, 'name'), Predicate.isString)
}

function nameAt(node: Node, key: string) {
	return Option.flatMap(nodeAt(node, key), nameOf)
}

function descendants(node: Node): Node[] {
	return [node, ...Array.flatMap(childrenOf(node), descendants)]
}

// A setting's source text on one line, as a reader would quote it.
function squeeze(text: string) {
	return String.trim(String.replaceAll(/\s+/gu, ' ')(text))
}

// Code compared for meaning: the formatter's line breaks, spacing around punctuation and trailing commas are no change. A string whose only edit is spacing beside punctuation reads as unchanged too.
function canonical(text: string) {
	return pipe(
		squeeze(text),
		String.replaceAll(/\s*([()[\]{},;:.=<>+\-*/!?&|`])\s*/gu, '$1'),
		String.replaceAll(/,([)\]}])/gu, '$1')
	)
}

function identifiers(node: Node) {
	return Array.dedupe(
		Array.flatMap(descendants(node), found => {
			if (!matches(/Identifier/u)(found.type)) return []
			return Option.toArray(nameOf(found))
		})
	)
}

function stringValue(node: Node) {
	if (node.type !== 'Literal') return Option.none()
	return Option.filter(field(node, 'value'), Predicate.isString)
}

function calleeText(source: string, node: Node) {
	return Option.match(nodeAt(node, 'callee'), {onNone: () => '', onSome: callee => textOf(source, callee)})
}

// `export` wraps a declaration; its inner statement names what it declares.
function declared(statement: Node) {
	return Option.getOrElse(nodeAt(statement, 'declaration'), () => statement)
}

function declarationsOf(statement: Node) {
	const inner = declared(statement)
	if (inner.type === 'VariableDeclaration') {
		return Array.flatMap(nodesAt(inner, 'declarations'), declarator =>
			Option.toArray(Option.map(nameAt(declarator, 'id'), name => ({name, node: declarator})))
		)
	}
	return Option.toArray(Option.map(nameAt(inner, 'id'), name => ({name, node: inner})))
}

// A node's code from `start` without the `WebRuntime.` of `WebRuntime.mount`: an import change adds or drops a namespace qualifier without changing what the code calls.
function codeText(source: string, start: number, node: Node, namespaces: string[]) {
	const qualifiers = pipe(
		descendants(node),
		Array.flatMap(found => {
			if (found.type !== 'MemberExpression' || Option.contains(field(found, 'computed'), true)) return []
			return Option.toArray(
				Option.zipWith(
					Option.filter(nodeAt(found, 'object'), object =>
						Option.exists(nameOf(object), name => object.type === 'Identifier' && Array.contains(namespaces, name))
					),
					nodeAt(found, 'property'),
					(object, property) => ({end: property.start, start: object.start})
				)
			)
		}),
		Array.sortWith(range => range.start, Number.Order)
	)
	return Array.join(
		Array.map(
			Array.zip([{end: start, start}, ...qualifiers], [...qualifiers, {end: node.end, start: node.end}]),
			pair => String.slice(pair[0].end, pair[1].start)(source)
		),
		''
	)
}

function exportName(node: Node, key: string) {
	return Option.orElse(nameAt(node, key), () => Option.flatMap(nodeAt(node, key), stringValue))
}

function exportedNames(statement: Node) {
	if (statement.type === 'ExportDefaultDeclaration') return [{local: 'default', name: 'default'}]
	if (statement.type !== 'ExportNamedDeclaration') return []
	return [
		...Array.map(Array.flatMap(Option.toArray(nodeAt(statement, 'declaration')), declarationsOf), found => ({
			local: found.name,
			name: found.name
		})),
		...Array.flatMap(nodesAt(statement, 'specifiers'), specifier =>
			Option.toArray(
				Option.zipWith(exportName(specifier, 'local'), exportName(specifier, 'exported'), (local, name) => ({
					local,
					name
				}))
			)
		)
	]
}

function yieldedArgument(node: Node) {
	if (node.type !== 'YieldExpression' || !Option.contains(field(node, 'delegate'), true)) return Option.none()
	return nodeAt(node, 'argument')
}

// A library service is read as `KeyValueStore.KeyValueStore`: its module and its tag share the name.
function libraryService(node: Node) {
	if (node.type !== 'MemberExpression') return Option.none()
	return Option.filter(nameAt(node, 'object'), name => Option.contains(nameAt(node, 'property'), name))
}

function isService(source: string, node: Node) {
	return Option.exists(nodeAt(node, 'superClass'), superClass =>
		matches(/^\w+\.Service\b/u)(textOf(source, superClass))
	)
}

// A layer is built by a `Layer` constructor, a `toLayer`, `HttpRouter.use`, a service's `.layer`, or a `pipe` that starts from or provides one.
function isLayer(source: string, node: Node): boolean {
	if (node.type === 'MemberExpression') return Option.contains(nameAt(node, 'property'), 'layer')
	if (node.type !== 'CallExpression') return false
	const callee = calleeText(source, node)
	if (matches(/^(?:Layer\.\w+|[\w.]+\.toLayer|HttpRouter\.use)$/u)(callee)) return true
	if (callee !== 'pipe' && !String.endsWith('.pipe')(callee)) return false
	return Array.some(
		[
			...nodesAt(node, 'arguments'),
			...Option.toArray(Option.flatMap(nodeAt(node, 'callee'), method => nodeAt(method, 'object')))
		],
		inner => isLayer(source, inner)
	)
}

// `Notes.layer` or `ServerRuntime.ToolPath.layer`, or the tag a `Layer.effect(Notes, …)` builds.
function partOf(source: string, node: Node) {
	if (node.type === 'MemberExpression' && Option.contains(nameAt(node, 'property'), 'layer')) {
		return Option.flatMap(nodeAt(node, 'object'), object =>
			Option.orElse(nameOf(object), () => nameAt(object, 'property'))
		)
	}
	if (
		node.type !== 'CallExpression' ||
		!matches(/^Layer\.(?:effect|scoped|succeed|sync)$/u)(calleeText(source, node))
	) {
		return Option.none()
	}
	return Option.flatMap(Array.head(nodesAt(node, 'arguments')), nameOf)
}

function providerOf(source: string, found: Located) {
	const yielded = Array.getSomes(Array.map(descendants(found.node), yieldedArgument))
	if (!isService(source, found.node) && !Option.exists(nodeAt(found.node, 'init'), init => isLayer(source, init))) {
		return []
	}
	return [
		{
			libraries: Array.dedupe(Array.getSomes(Array.map(yielded, libraryService))),
			name: found.name,
			parts: Array.dedupe(Array.getSomes(Array.map(descendants(found.node), node => partOf(source, node)))),
			service: isService(source, found.node),
			text: found.text,
			// Any yielded name; only the ones that name a service class become edges.
			yields: Array.dedupe(Array.getSomes(Array.map(yielded, nameOf)))
		}
	]
}

// The name a chain of calls, members and instantiations starts from: `Schema` for `Schema.Struct({…}).pipe(…)`.
function rootName(node: Node): Option.Option<string> {
	if (node.type === 'Identifier') return nameOf(node)
	return Option.flatMap(
		Option.firstSomeOf([nodeAt(node, 'callee'), nodeAt(node, 'object'), nodeAt(node, 'expression')]),
		rootName
	)
}

// A schema is a value built from `Schema` or `Model`, or a class extending one, such as `Schema.TaggedError`.
function isSchema(found: Located) {
	return Option.exists(
		Option.flatMap(
			Option.orElse(nodeAt(found.node, 'init'), () => nodeAt(found.node, 'superClass')),
			rootName
		),
		name => name === 'Schema' || name === 'Model'
	)
}

function isImport(statement: Node) {
	return (
		Array.contains(['ImportDeclaration', 'ExportAllDeclaration'], statement.type) ||
		(statement.type === 'ExportNamedDeclaration' && Option.isSome(nodeAt(statement, 'source')))
	)
}

function statementKey(statement: Node) {
	const names = Boolean.match(statement.type === 'ExportDefaultDeclaration', {
		onFalse: () =>
			Array.join(
				Array.map(declarationsOf(statement), found => found.name),
				', '
			),
		onTrue: () => 'default'
	})
	if (names === '') return ''
	if (matches(/^TS(?:TypeAlias|Interface)Declaration$/u)(declared(statement).type)) return `type ${names}`
	return names
}

function statementsOf(source: string, body: Node[], namespaces: string[]) {
	return Array.flatMap(body, (statement, index) => {
		if (isImport(statement)) return []
		const text = codeText(
			source,
			Option.getOrElse(
				Option.map(Array.get(body, index - 1), previous => previous.end),
				() => 0
			),
			statement,
			namespaces
		)
		return [
			{
				exported: String.startsWith('Export')(statement.type),
				key: statementKey(statement),
				lines: Array.filter(Array.map(String.split('\n')(text), canonical), String.isNonEmpty),
				text: canonical(text)
			} satisfies Statement
		]
	})
}

// Each imported binding's module: `Account` from `@deslop/runtime/shared/schema`.
function importedOf(body: Node[]) {
	return Record.fromEntries(
		Array.flatMap(body, statement => {
			if (statement.type !== 'ImportDeclaration') return []
			return Array.flatMap(nodesAt(statement, 'specifiers'), specifier =>
				Option.toArray(
					Option.zipWith(
						nameAt(specifier, 'local'),
						Option.flatMap(nodeAt(statement, 'source'), stringValue),
						(local, from) => [local, from] as const
					)
				)
			)
		})
	)
}

function routeOf(source: string, call: Node) {
	const [method, path] = nodesAt(call, 'arguments')
	if (!matches(/(?:^|\.)add$/u)(calleeText(source, call)) || method === undefined || path === undefined) {
		return Option.none()
	}
	return Option.map(
		Option.filter(stringValue(method), verb =>
			Array.contains(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', '*'], verb)
		),
		verb => `${verb} ${Option.getOrElse(stringValue(path), () => textOf(source, path))}`
	)
}

function contractOf(source: string, call: Node, namespaces: string[]) {
	const callee = calleeText(source, call)
	if (callee !== 'Rpc.make' && callee !== 'Tool.make') return Option.none()
	return Option.map(Option.flatMap(Array.head(nodesAt(call, 'arguments')), stringValue), name => ({
		kind: Boolean.match(callee === 'Rpc.make', {onFalse: () => 'tool' as const, onTrue: () => 'rpc' as const}),
		name,
		names: identifiers(call),
		text: canonical(codeText(source, call.start, call, namespaces))
	}))
}

// What one TypeScript module declares, exports, provides, routes and stores, read without running it.
export function factsOf(filename: string, source: string) {
	const program = parseSync(filename, source).program
	const namespaces = Array.flatMap(program.body, statement =>
		Array.flatMap(nodesAt(statement, 'specifiers'), specifier => {
			if (specifier.type !== 'ImportNamespaceSpecifier') return []
			return Option.toArray(nameAt(specifier, 'local'))
		})
	)
	const declarations = Array.map(
		Array.flatMap(program.body, declarationsOf),
		found =>
			({
				...found,
				names: identifiers(found.node),
				text: canonical(codeText(source, found.node.start, found.node, namespaces))
			}) satisfies Located
	)
	const calls = Array.filter(descendants(program), node => node.type === 'CallExpression')
	return {
		contracts: Array.flatMap(calls, call => Option.toArray(contractOf(source, call, namespaces))),
		declarations: Array.map(declarations, found => ({name: found.name, names: found.names, text: found.text})),
		exports: Record.fromEntries(
			Array.map(Array.flatMap(program.body, exportedNames), entry => [
				entry.name,
				pipe(
					Array.filter(declarations, found => found.name === entry.local),
					Array.map(found => found.text),
					Array.join(' ')
				)
			])
		),
		imported: importedOf(program.body),
		providers: Array.flatMap(declarations, found => providerOf(source, found)),
		routes: Array.flatMap(calls, call => Option.toArray(routeOf(source, call))),
		schemas: Array.map(Array.filter(declarations, isSchema), found => found.name),
		statements: statementsOf(source, program.body, namespaces),
		// The names a stored row's schema starts from; the schemas they reach are stored too.
		stored: [
			// A table's row: `Model.Class` from `effect/unstable/schema`.
			...Array.flatMap(declarations, found =>
				Array.filter([found.name], () =>
					Option.exists(nodeAt(found.node, 'superClass'), superClass =>
						matches(/^Model\.Class\b/u)(textOf(source, superClass))
					)
				)
			),
			// A key-value document, until the data layer moves the last one to a table.
			...Array.flatMap(calls, call => {
				if (!matches(/toSchemaStore$/u)(calleeText(source, call))) return []
				return Option.match(Array.get(nodesAt(call, 'arguments'), 1), {onNone: () => [], onSome: identifiers})
			})
		]
	}
}

export type Facts = ReturnType<typeof factsOf>

function keyOf(source: string, key: Node) {
	return Option.getOrElse(
		Option.orElse(nameOf(key), () => stringValue(key)),
		() => textOf(source, key)
	)
}

function joined(path: string, key: string) {
	if (path === '') return key
	return `${path}.${key}`
}

// An object in a list is named by its first string property, such as a zone's `name` or a pattern's `message`, else its first property's value; any other item by its own text, as `error` in `['error', {…}]`; so inserting one renames no other.
function elementKey(source: string, element: Node, index: number) {
	if (element.type !== 'ObjectExpression') {
		return Option.getOrElse(stringValue(element), () => squeeze(textOf(source, element)))
	}
	const values = Array.getSomes(Array.map(nodesAt(element, 'properties'), property => nodeAt(property, 'value')))
	return Option.getOrElse(
		Option.orElse(Array.findFirst(values, stringValue), () =>
			Option.map(Array.head(values), value => squeeze(textOf(source, value)))
		),
		() => `${index}`
	)
}

// A list of plain values is one setting per item, so adding one pattern reads as that pattern: `zones[shared].patterns[] packages/runtime/src/shared/**`.
export const ITEM = '[] '

function settingsOf(node: Node, path: string, source: string): (readonly [string, string])[] {
	if (Array.contains(['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression'], node.type)) {
		return Array.flatMap(Option.toArray(nodeAt(node, 'expression')), inner => settingsOf(inner, path, source))
	}
	if (node.type === 'CallExpression') {
		return Array.flatMap(nodesAt(node, 'arguments'), inner => settingsOf(inner, path, source))
	}
	if (node.type === 'ObjectExpression') {
		return Array.flatMap(nodesAt(node, 'properties'), property =>
			Option.match(Option.all({key: nodeAt(property, 'key'), value: nodeAt(property, 'value')}), {
				onNone: () => [[joined(path, '...'), squeeze(textOf(source, property))] as const],
				onSome: found => settingsOf(found.value, joined(path, keyOf(source, found.key)), source)
			})
		)
	}
	const elements = nodesAt(node, 'elements')
	if (node.type === 'ArrayExpression' && Array.some(elements, element => element.type === 'ObjectExpression')) {
		return Array.flatMap(elements, (element, index) =>
			settingsOf(element, `${path}[${elementKey(source, element, index)}]`, source)
		)
	}
	if (node.type === 'ArrayExpression' && Array.isReadonlyArrayNonEmpty(elements)) {
		return Array.map(elements, element => {
			const item = Option.getOrElse(stringValue(element), () => squeeze(textOf(source, element)))
			return [`${path}${ITEM}${item}`, item] as const
		})
	}
	return [[path, Option.getOrElse(stringValue(node), () => squeeze(textOf(source, node)))]]
}

function statementSettings(statement: Node, source: string) {
	const inner = declared(statement)
	if (inner.type === 'VariableDeclaration') {
		return Array.flatMap(nodesAt(inner, 'declarations'), declarator =>
			Option.match(Option.all({init: nodeAt(declarator, 'init'), name: nameAt(declarator, 'id')}), {
				onNone: () => [],
				onSome: found => settingsOf(found.init, found.name, source)
			})
		)
	}
	if (inner.type === 'ExpressionStatement') {
		return Array.flatMap(Option.toArray(nodeAt(inner, 'expression')), expression => settingsOf(expression, '', source))
	}
	if (statement.type === 'ExportDefaultDeclaration') return settingsOf(inner, '', source)
	return []
}

// Every setting of a configuration module or JSON(C) file as a dotted path and its source text, so a rule turned on reads as one line.
export function settings(filename: string, source: string) {
	if (String.endsWith('.json')(filename)) {
		const text = `(${source})`
		return Record.fromEntries(
			Array.flatMap(parseSync('config.ts', text).program.body, statement => statementSettings(statement, text))
		)
	}
	return Record.fromEntries(
		Array.flatMap(parseSync(filename, source).program.body, statement => statementSettings(statement, source))
	)
}

function lockState(state: LockState, line: string) {
	return Option.match(String.match(/^( *)('?)([^':]+)\2:/u)(line), {
		onNone: () => state,
		onSome: found => {
			const key = found[3] ?? ''
			const indent = (found[1] ?? '').length
			if (indent === 0) return {importer: '', name: '', section: key}
			if (indent === 2) return {...state, importer: key}
			if (indent === 6) return {...state, name: key}
			return state
		}
	})
}

// Each importer's resolved direct dependency versions from a pnpm lockfile, keyed `importer name`; workspace links are not versions.
export function lockedVersions(lockfile: string) {
	const lines = String.split('\n')(lockfile)
	// Each line's state follows it: `scan` starts with the state before the first line.
	const states = Array.scan(lines, {importer: '', name: '', section: ''}, lockState)
	return Record.fromEntries(
		Array.flatMap(lines, (line, index) =>
			Option.toArray(
				Option.flatMap(
					Option.filter(Array.get(states, index + 1), state => state.section === 'importers'),
					state =>
						pipe(
							String.match(/^ {8}version: '?([^'(]+)/u)(line),
							Option.flatMap(found => Option.fromUndefinedOr(found[1])),
							Option.filter(version => !String.startsWith('link:')(version)),
							Option.map(version => [`${state.importer} ${state.name}`, version] as const)
						)
				)
			)
		)
	)
}
