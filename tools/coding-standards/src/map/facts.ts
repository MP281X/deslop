import {Array, Boolean, Option, Predicate, Record, String, pipe} from 'effect'

import {parseSync} from 'oxc-parser'

import {matches} from '#lib/ast.ts'
import type {Node} from '#lib/nodes.ts'
import {childrenOf, field, nodeAt, nodesAt, textOf} from '#lib/nodes.ts'

// A top-level declaration with every name its code reads, so a schema's shape can follow the schemas it holds.
export type Declaration = {name: string; names: string[]; text: string}

// A service class or a layer built at the top level, with the services its code yields.
export type Provider = {libraries: string[]; name: string; service: boolean; text: string; yields: string[]}

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

// Whitespace never changes a declaration's meaning here, so a reformat is no change.
function squeeze(text: string) {
	return String.trim(String.replaceAll(/\s+/gu, ' ')(text))
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

function located(source: string, name: string, node: Node) {
	return {name, names: identifiers(node), node, text: squeeze(textOf(source, node))} satisfies Located
}

function declarationsOf(source: string, statement: Node) {
	const inner = declared(statement)
	if (inner.type === 'VariableDeclaration') {
		return Array.flatMap(nodesAt(inner, 'declarations'), declarator =>
			Option.toArray(Option.map(nameAt(declarator, 'id'), name => located(source, name, declarator)))
		)
	}
	return Option.toArray(Option.map(nameAt(inner, 'id'), name => located(source, name, inner)))
}

function exportName(node: Node, key: string) {
	return Option.orElse(nameAt(node, key), () => Option.flatMap(nodeAt(node, key), stringValue))
}

function exportedNames(statement: Node) {
	if (statement.type === 'ExportDefaultDeclaration') return [{local: 'default', name: 'default'}]
	if (statement.type !== 'ExportNamedDeclaration') return []
	return [
		...Array.map(
			Array.flatMap(Option.toArray(nodeAt(statement, 'declaration')), inner => declarationsOf('', inner)),
			found => ({local: found.name, name: found.name})
		),
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

function providerOf(source: string, found: Located) {
	const yielded = Array.getSomes(Array.map(descendants(found.node), yieldedArgument))
	if (
		!isService(source, found.node) &&
		!Option.exists(
			nodeAt(found.node, 'init'),
			init =>
				init.type === 'CallExpression' &&
				matches(/^(?:Layer\.\w+|[\w.]+\.toLayer|HttpRouter\.use)$/u)(calleeText(source, init))
		)
	) {
		return []
	}
	return [
		{
			libraries: Array.dedupe(Array.getSomes(Array.map(yielded, libraryService))),
			name: found.name,
			service: isService(source, found.node),
			text: found.text,
			// Any yielded name; only the ones that name a service class become edges.
			yields: Array.dedupe(Array.getSomes(Array.map(yielded, nameOf)))
		}
	]
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

function contractOf(source: string, call: Node) {
	const callee = calleeText(source, call)
	if (callee !== 'Rpc.make' && callee !== 'Tool.make') return Option.none()
	return Option.map(Option.flatMap(Array.head(nodesAt(call, 'arguments')), stringValue), name => ({
		kind: Boolean.match(callee === 'Rpc.make', {onFalse: () => 'tool' as const, onTrue: () => 'rpc' as const}),
		name,
		names: identifiers(call),
		text: squeeze(textOf(source, call))
	}))
}

// What one TypeScript module declares, exports, provides, routes and stores, read without running it.
export function factsOf(filename: string, source: string) {
	const program = parseSync(filename, source).program
	const declarations = Array.flatMap(program.body, statement => declarationsOf(source, statement))
	const calls = Array.filter(descendants(program), node => node.type === 'CallExpression')
	return {
		contracts: Array.flatMap(calls, call => Option.toArray(contractOf(source, call))),
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
		providers: Array.flatMap(declarations, found => providerOf(source, found)),
		routes: Array.flatMap(calls, call => Option.toArray(routeOf(source, call))),
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

// An object in a list is named by its first property's value, such as an override's `files`, so inserting one renames no other.
function elementKey(source: string, element: Node, index: number) {
	return Option.getOrElse(
		pipe(
			Array.head(nodesAt(element, 'properties')),
			Option.flatMap(property => nodeAt(property, 'value')),
			Option.map(value => squeeze(Option.getOrElse(stringValue(value), () => textOf(source, value))))
		),
		() => `${index}`
	)
}

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
	return [[path, squeeze(textOf(source, node))]]
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
