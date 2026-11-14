import {Array, Function, HashSet, MutableList, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer, Variable} from 'vite-plus/lint/plugins'

import {
	childNodes,
	importedMember,
	isFunction,
	isSchemaDefinition,
	matches,
	memberName,
	resolveBinding,
	variableFromScope
} from '#lib/ast.ts'
import {literalConstant, singleUseModulePrimitive} from '#lib/module-literal.ts'
import {discardedBindingName} from '#lint/no-pass-through-name.ts'
import {publicServiceName, spanNames} from '#lint/service-method-span.ts'

const NON_BOOLEAN_OPERATORS = ['%', '&', '*', '**', '+', '-', '/', '<<', '>>', '>>>', '^', '|']
const NON_BOOLEAN_NODES = [
	'ArrayExpression',
	'ClassExpression',
	'JSXElement',
	'JSXFragment',
	'NewExpression',
	'ObjectExpression',
	'TemplateLiteral',
	'UpdateExpression'
]
const isBooleanName = matches(/^(?:is|has|can|should)[A-Z0-9]/u)

// Oxlint exposes no TypeScript program to JS rules; use the annotations present in its AST.
function annotation(context: Context, node: ESTree.Node) {
	if (node.type !== 'Identifier') return Option.none<ESTree.TSType>()
	return Option.flatMap(variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}), variable =>
		Option.flatMap(Array.head(variable.identifiers), id => Option.fromNullishOr(id.typeAnnotation?.typeAnnotation))
	)
}

function hasLength(type: ESTree.TSType): boolean {
	if (type.type === 'TSTypeOperator' && type.operator === 'readonly') return hasLength(type.typeAnnotation)
	return (
		type.type === 'TSStringKeyword' ||
		type.type === 'TSArrayType' ||
		type.type === 'TSTupleType' ||
		(type.type === 'TSTypeReference' &&
			type.typeName.type === 'Identifier' &&
			Array.contains(['Array', 'ReadonlyArray'], type.typeName.name))
	)
}

function nonBooleanType(type: ESTree.TSType): boolean {
	if (type.type === 'TSUnionType') return Array.every(type.types, nonBooleanType)
	return (
		hasLength(type) ||
		Array.contains(['TSBigIntKeyword', 'TSNumberKeyword', 'TSSymbolKeyword'], type.type) ||
		(type.type === 'TSTypeLiteral' && Array.every(type.members, member => member.type !== 'TSCallSignatureDeclaration'))
	)
}

function nonBoolean(context: Context, node: ESTree.Node) {
	if (node.type === 'Literal') return node.value !== null && !Predicate.isBoolean(node.value)
	if (node.type === 'BinaryExpression') return Array.contains(NON_BOOLEAN_OPERATORS, node.operator)
	if (node.type === 'UnaryExpression') return Array.contains(['+', '-', 'typeof', '~'], node.operator)
	if (Option.exists(annotation(context, node), nonBooleanType)) return true
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'length')) {
		const object = resolveBinding(context, node.object)
		return (
			Option.exists(annotation(context, node.object), hasLength) ||
			object.type === 'ArrayExpression' ||
			(object.type === 'Literal' && Predicate.isString(object.value))
		)
	}
	return Array.contains(NON_BOOLEAN_NODES, node.type)
}

// The values a function returns from its own body, not from the functions inside it.
function returnedValues(context: Context, node: ESTree.Node): ESTree.Node[] {
	if (node.type === 'ReturnStatement') return Option.toArray(Option.fromNullishOr(node.argument))
	if (isFunction(node)) return []
	return Array.flatMap(childNodes(context, node), child => returnedValues(context, child))
}

function returnsNonBoolean(context: Context, node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.generator || node.body === null) return false
	if (node.body.type !== 'BlockStatement') return nonBoolean(context, node.body)
	return pipe(
		node.body.body,
		Array.flatMap(statement => returnedValues(context, statement)),
		Array.some(value => nonBoolean(context, value))
	)
}

type NameFinding = {node: ESTree.Node; form: string; fix?: Parameters<Context['report']>[0]['fix']}
type NamingRow = {selector: string; check: (context: Context, node: ESTree.Node) => NameFinding[]}

function finding(node: ESTree.Node, form: string, fix?: NameFinding['fix']) {
	return [{fix, form, node}]
}

function booleanName(context: Context, node: ESTree.Node) {
	if (
		node.type === 'FunctionDeclaration' &&
		node.id !== null &&
		isBooleanName(node.id.name) &&
		returnsNonBoolean(context, node)
	) {
		return finding(node.id, 'a non-boolean domain name, or return a boolean for is/has/can/should')
	}
	if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || node.init === null) return []
	if (isSchemaDefinition({context, node: node.init})) {
		if (!matches(/^[A-Z]/u)(node.id.name)) return finding(node, 'one PascalCase schema/type name')
		return []
	}
	if (
		isBooleanName(node.id.name) &&
		(nonBoolean(context, node.init) ||
			((node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
				returnsNonBoolean(context, node.init)))
	) {
		return finding(node.id, 'a non-boolean domain name, or return a boolean for is/has/can/should')
	}
	return []
}

function renamed(fixer: Fixer, name: string, reference: Variable['references'][number]) {
	if (reference.identifier.parent.type === 'Property' && reference.identifier.parent.shorthand) {
		return fixer.replaceText(reference.identifier, `${reference.identifier.name}: ${name}`)
	}
	return fixer.replaceText(reference.identifier, name)
}

function constantName(context: Context, program: ESTree.Node) {
	if (program.type !== 'Program') return []
	const leadingEnd = pipe(
		program.body,
		Array.takeWhile(statement => statement.type === 'ImportDeclaration' || Option.isSome(literalConstant(statement))),
		Array.last,
		Option.map(statement => statement.range[1]),
		Option.getOrElse(Function.constant(0))
	)
	return Array.flatMap(program.body, statement =>
		pipe(
			literalConstant(statement),
			Option.flatMap(found =>
				pipe(
					variableFromScope({name: found.id.name, scope: context.sourceCode.getScope(found.node)}),
					Option.filter(
						variable =>
							!Array.some(variable.references, reference => reference.identifier.parent.type === 'ExportSpecifier')
					),
					Option.map(variable => ({found, variable}))
				)
			),
			Option.match({
				onNone: () => [],
				onSome: match => {
					if (singleUseModulePrimitive(context, match.found.node)) return []
					const name = pipe(match.found.id.name, String.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/gu, '_'), String.toUpperCase)
					const correctName = matches(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u)(match.found.id.name)
					const leading = statement.range[1] <= leadingEnd
					if (correctName && leading) return []
					const taken = Array.some(
						[match.found.id, ...Array.map(match.variable.references, reference => reference.identifier)],
						node => Option.isSome(variableFromScope({name, scope: context.sourceCode.getScope(node)}))
					)
					return finding(match.found.node, `the module constant ${name} directly under the imports`, fixer => {
						if (correctName || taken) return []
						return [
							fixer.replaceTextRange(
								[match.found.id.range[0], match.found.id.range[0] + match.found.id.name.length],
								name
							),
							...pipe(
								match.variable.references,
								Array.filter(reference => reference.identifier !== match.found.id),
								Array.map(reference => renamed(fixer, name, reference))
							)
						]
					})
				}
			})
		)
	)
}

function namedForm(form: string) {
	return (_context: Context, node: ESTree.Node) => finding(node, form)
}

function descendants(context: Context, node: ESTree.Node): ESTree.Node[] {
	return pipe(
		childNodes(context, node),
		Array.flatMap(child => descendants(context, child)),
		Array.prepend(node)
	)
}

function spanName(context: Context, program: ESTree.Node) {
	const nodes = descendants(context, program)
	const publicNames = Array.flatMap(nodes, node => {
		if (node.type !== 'Property') return []
		return pipe(
			publicServiceName(context, node),
			Option.toArray,
			Array.flatMap(name => Array.map(spanNames(context, node.value), literal => ({literal, name, value: node.value})))
		)
	})
	const owned = HashSet.fromIterable(Array.map(publicNames, span => span.literal.range[0]))
	return pipe(
		publicNames,
		Array.flatMap(span => {
			if (
				span.literal.type !== 'Literal' ||
				!Predicate.isString(span.literal.value) ||
				span.literal.value === span.name
			) {
				return []
			}
			return finding(span.literal, `the public service span '${span.name}'`, fixer => {
				if (span.literal.range[0] < span.value.range[0] || span.literal.range[1] > span.value.range[1]) return []
				return fixer.replaceText(span.literal, `'${span.name}'`)
			})
		}),
		Array.appendAll(
			Array.flatMap(nodes, node => {
				if (
					node.type !== 'CallExpression' ||
					node.callee.type !== 'MemberExpression' ||
					!importedMember({context, importedName: 'Effect', node: node.callee}) ||
					!Option.exists(memberName(node.callee), name => name === 'fn' || name === 'withSpan')
				) {
					return []
				}
				return Array.flatMap(node.arguments, literal => {
					if (
						literal.type !== 'Literal' ||
						!Predicate.isString(literal.value) ||
						HashSet.has(owned, literal.range[0]) ||
						matches(/^[A-Z][A-Za-z]*\.[a-z][A-Za-z]*$/u)(literal.value)
					) {
						return []
					}
					return finding(literal, 'a span Service.method')
				})
			})
		)
	)
}

const NAMING: NamingRow[] = [
	{
		check: (context, node) => Array.appendAll(constantName(context, node), spanName(context, node)),
		selector: 'Program'
	},
	{check: booleanName, selector: 'FunctionDeclaration'},
	{check: booleanName, selector: 'VariableDeclarator'},
	{
		check: namedForm('the domain value, not data/info/obj/temp/tmp/helper/manager/handle'),
		selector:
			':matches(VariableDeclarator > Identifier.id, FunctionDeclaration > Identifier.id, ClassDeclaration > Identifier.id, :matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > Identifier.params, CatchClause > Identifier.param)[name=/^(data|info|obj|temp|tmp|helper|manager|handle)$/]'
	},
	{
		check: namedForm('an error class <Domain>Error'),
		selector:
			'ClassDeclaration[superClass.callee.callee.object.name="Schema"][superClass.callee.callee.property.name="TaggedError"]:not([id.name=/Error$/])'
	},
	{
		check: namedForm('an atom with the Atom suffix (or an atom family/runtime with Atoms/Runtime)'),
		selector:
			'VariableDeclarator:not([id.name=/(Atom|Runtime|Atoms)$/]) > CallExpression.init:matches([callee.object.name="Atom"][callee.property.name=/^(make|readable|fn|fnSync|runtime|writable|family|keepAlive|withLabel)$/], [callee.property.name=/^(atom|fn|pull)$/][callee.object.property.name="runtime"], [callee.property.name=/^(atom|fn|pull)$/][callee.object.name=/Runtime$/], [callee.property.name=/^(atom|fn|pull)$/][callee.object.callee.object.name="Atom"][callee.object.callee.property.name="runtime"])'
	},
	{
		check: namedForm('an error mapping combinator as<Domain>Error'),
		selector:
			'VariableDeclarator:not([id.name=/^as[A-Z]\\w*Error$/]) > CallExpression[callee.object.name="Effect"][callee.property.name="mapError"][arguments.length=1]'
	},
	{
		check: namedForm('a tool in snake_case'),
		selector:
			'CallExpression[callee.object.name="Tool"][callee.property.name="make"] > Literal.arguments:first-child:not([value=/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/])'
	}
]

function nameOwner(node: ESTree.Node) {
	if (
		node.type === 'Identifier' &&
		(node.parent.type === 'VariableDeclarator' ||
			node.parent.type === 'FunctionDeclaration' ||
			node.parent.type === 'ClassDeclaration') &&
		node.parent.id === node
	) {
		return node.parent
	}
	if (node.type === 'CallExpression' && node.parent.type === 'VariableDeclarator' && node.parent.init === node) {
		return node.parent
	}
	return node
}

export const nameByKind = defineRule({
	create: context => {
		const pending = MutableList.make<NameFinding>()
		function listener(row: NamingRow) {
			return (node: ESTree.Node) => {
				MutableList.appendAll(pending, row.check(context, node))
			}
		}
		return {
			...Record.fromIterableWith(NAMING, row => [row.selector, listener(row)]),
			'Program:exit': (program: ESTree.Program) => {
				const executed = Array.filter(descendants(context, program), node =>
					Array.contains(
						[
							'AssignmentExpression',
							'AwaitExpression',
							'CallExpression',
							'NewExpression',
							'TaggedTemplateExpression',
							'UpdateExpression',
							'YieldExpression'
						],
						node.type
					)
				)
				pipe(
					MutableList.toArray(pending),
					Array.filter(match => !discardedBindingName(context, nameOwner(match.node), executed)),
					Array.groupBy(match => `${nameOwner(match.node).range[0]}`),
					Record.values,
					Array.forEach(group => {
						const first = Array.headNonEmpty(group)
						const forms = pipe(
							group,
							Array.map(match => match.form),
							Array.dedupe,
							Array.join(' and ')
						)
						context.report({
							fix: fixer => {
								if (group.length !== 1 || first.fix === undefined) return []
								return first.fix(fixer)
							},
							message: `Name this value as ${forms}.`,
							node: first.node
						})
					})
				)
			}
		}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Schema} from 'effect'
import {Tool} from 'effect/ai'
import {Atom} from 'effect/reactivity'
export type Visibility = typeof Visibility.Type
export const Visibility = Schema.Literals(['private', 'public'])
export class NoteError extends Schema.TaggedError<NoteError>()('NoteError', {cause: Schema.Defect()}) {}
export const noteAtom = Atom.make('')
export const readNoteTool = Tool.make('read_note', {parameters: Tool.EmptyParams, success: Schema.String})`
					},
					{'sample.ts': 'export function hasBudget(balance: number) { return balance > 0 }'},
					{
						'sample.ts': `const LIMIT = 4
export function remaining(used: number) { return LIMIT - used }
export function isFull(used: number) { return used >= LIMIT }`
					}
				],
				fixes: [
					{
						'sample.ts': `const limit = 4
export function remaining(used: number) { return limit - used }
export function isFull(used: number) { return used >= limit }`
					},
					{
						'sample.ts': `import {Clock, Context, Effect} from 'effect'
export class Notes extends Context.Service<Notes>()('name-by-kind/fixes-1/sample/Notes', {make: Effect.gen(function* () {
yield* Effect.logDebug('start')
return {read: Effect.fn('Other.read')(function* () { yield* Effect.logDebug('read'); return yield* Clock.currentTimeMillis })}
})}) {}`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
