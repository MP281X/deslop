import {
	Array,
	Boolean,
	DateTime,
	Effect,
	Function,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Result,
	String,
	Struct,
	pipe
} from 'effect'

import {TelemetryError} from '#services/telemetry/schema.ts'
import type {AppName, IngestionAnswer, LogsAnswer, OperationsAnswer} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import type {OperationCursor} from '#tools/contracts.ts'

// Offsets count UTF-16 units; a window that would split a character takes all of it, and the next window skips the half already given.
function sliceWhole(text: string, offset: number, limit: number) {
	const startsInside = pipe(
		text,
		String.charCodeAt(offset),
		Option.exists(Number.between({maximum: 0xdf_ff, minimum: 0xdc_00}))
	)
	const endsInside = pipe(
		text,
		String.charCodeAt(offset + limit - 1),
		Option.exists(Number.between({maximum: 0xdb_ff, minimum: 0xd8_00}))
	)
	return String.slice(
		offset + Boolean.match(startsInside, {onFalse: Function.constant(0), onTrue: Function.constant(1)}),
		offset + limit + Boolean.match(endsInside, {onFalse: Function.constant(0), onTrue: Function.constant(1)})
	)(text)
}

function textWindow(text: string, offset: number, limit: number) {
	return {
		nextTextOffset: Option.liftPredicate(offset + limit, next => next < text.length),
		text: sliceWhole(text, offset, limit)
	}
}

// The leading rows whose text fits 64,000 characters, always at least one; past it, a page ends early and its continuation picks up the rest.
function withinBudget<A>(rows: readonly A[], size: (row: A) => number) {
	const [, kept] = Array.mapAccum(rows, 0, (used, row, index) => {
		const total = used + size(row)
		return [total, Option.liftPredicate(row, () => index === 0 || total <= 64_000)] as const
	})
	return Array.getSomes(Array.takeWhile(kept, Option.isSome))
}

function attributeWindow(
	attrs: Readonly<Record<string, string | number | boolean>>,
	input: {
		attribute: Option.Option<string>
		attributeCursor: Option.Option<string>
		textOffset: number
		textLimit: number
	}
) {
	const entries = pipe(
		attrs,
		Record.toEntries,
		Array.sort(Order.mapInput(Order.String, (entry: readonly [string, string | number | boolean]) => entry[0])),
		Array.filter(
			entry =>
				Option.match(input.attribute, {onNone: Function.constTrue, onSome: key => entry[0] === key}) &&
				Option.match(input.attributeCursor, {onNone: Function.constTrue, onSome: cursor => entry[0] > cursor})
		)
	)
	const page = Array.take(entries, 20)
	return {
		attributes: pipe(
			page,
			Array.map(entry => {
				if (Predicate.isString(entry[1])) {
					return [entry[0], sliceWhole(entry[1], input.textOffset, input.textLimit)] as const
				}
				return entry
			}),
			Record.fromEntries
		),
		nextAttribute: pipe(
			page,
			Array.last,
			Option.filter(() => entries.length > page.length),
			Option.map(entry => entry[0])
		),
		nextTextOffset: Option.liftPredicate(input.textOffset + input.textLimit, () =>
			Array.some(page, entry => Predicate.isString(entry[1]) && entry[1].length > input.textOffset + input.textLimit)
		)
	}
}

function ingestionResult(
	answer: IngestionAnswer,
	input: typeof ToolContracts.tools.check_ingestion.parametersSchema.Type
) {
	return {
		...answer,
		services: Array.filter(answer.services, service =>
			Option.match(input.app, {onNone: Function.constTrue, onSome: app => service.app === app})
		)
	}
}

// Failing operations first, then by app, name and side; a cursor is the last row's place in that order.
const operationOrder = pipe(
	Order.mapInput(Order.flip(Order.Boolean), (key: OperationCursor) => key.failed),
	Order.combine(Order.mapInput(Order.String, (key: OperationCursor) => key.app)),
	Order.combine(Order.mapInput(Order.String, (key: OperationCursor) => key.name)),
	Order.combine(Order.mapInput(Order.String, (key: OperationCursor) => key.side))
)

function operationPage(
	answer: OperationsAnswer,
	input: typeof ToolContracts.tools.list_operations.parametersSchema.Type
) {
	const remaining = pipe(
		answer.apps,
		Array.flatMap(app =>
			Array.map(app.operations, operation => ({
				app: app.app,
				key: {
					app: app.app,
					failed: Option.exists(operation.failedTraces, count => count > 0),
					name: operation.name,
					side: Option.getOrElse(operation.side, Function.constant(''))
				} satisfies OperationCursor,
				operation
			}))
		),
		Array.sort(Order.mapInput(operationOrder, (row: {app: AppName; key: OperationCursor}) => row.key)),
		Array.filter(
			row =>
				Option.match(input.operation, {onNone: Function.constTrue, onSome: name => row.operation.name === name}) &&
				Option.match(input.cursor, {onNone: Function.constTrue, onSome: cursor => operationOrder(row.key, cursor) > 0})
		)
	)
	const page = Array.take(remaining, input.limit)
	const byApp = Array.groupBy(page, row => row.app)
	return {
		apps: Array.flatMap(answer.apps, app =>
			pipe(
				byApp,
				Record.get(app.app),
				Option.match({
					onNone: () => [],
					onSome: rows => [{app: app.app, operations: Array.map(rows, row => row.operation)}]
				})
			)
		),
		nextCursor: pipe(
			page,
			Array.last,
			Option.filter(() => remaining.length > input.limit),
			Option.map(row => row.key)
		)
	}
}

function traceResult(
	answer: Effect.Success<ReturnType<typeof Telemetry.Service.readTrace>>,
	input: typeof ToolContracts.tools.read_trace.parametersSchema.Type
) {
	const metadata = {
		...Struct.omit(answer, ['spans', 'logs', 'nextOffset']),
		attributes: Option.none(),
		logs: Option.none(),
		nextAttribute: Option.none(),
		nextOffset: Option.none(),
		nextTextOffset: Option.none()
	}
	const spans = answer.spans
	if (Option.isSome(input.span) && Array.isReadonlyArrayEmpty(spans)) {
		return Result.fail(
			TelemetryError.make({message: 'This span is not in this trace page; omit span and use nextOffset to locate it.'})
		)
	}
	if (input.section === 'attributes') {
		if (Option.isNone(input.span)) {
			return Result.fail(
				TelemetryError.make({message: 'section=attributes requires span; choose a span id from read_trace.'})
			)
		}
		if (!Array.isReadonlyArrayNonEmpty(spans)) {
			return Result.fail(
				TelemetryError.make({
					message: 'This span is not in this trace page; omit span and use nextOffset to locate it.'
				})
			)
		}
		const attrs = Option.getOrElse(Array.headNonEmpty(spans).attrs, () => ({}))
		return pipe(
			input.attribute,
			Option.filter(key => !Record.has(attrs, key)),
			Option.match({
				onNone: () => {
					const window = attributeWindow(attrs, input)
					return Result.succeed({...metadata, ...window, attributes: Option.some(window.attributes), spans: []})
				},
				onSome: key =>
					Result.fail(
						TelemetryError.make({
							message: pipe(
								Record.keys(attrs),
								Array.sort(Order.String),
								Array.take(20),
								Array.match({
									onEmpty: () => `Unknown attribute ${key}; this span has no attributes.`,
									onNonEmpty: keys =>
										`Unknown attribute ${key}; omit attribute to page through them all, which start with ${Array.join(keys, ', ')}.`
								})
							)
						})
					)
			})
		)
	}
	if (input.section === 'logs') {
		// One time order across the trace, each line naming its span, so a job's line sits between its steps' lines.
		const spanLogs = Array.flatMap(spans, span => Option.getOrElse(span.logs, () => []))
		const all = Array.sort(
			[
				...pipe(
					answer.logs,
					Option.filter(() => Option.isNone(input.span)),
					Option.getOrElse(() => [])
				),
				...spanLogs
			],
			Order.mapInput(DateTime.Order, (log: {at: DateTime.Utc}) => log.at)
		)
		const logs = withinBudget(
			Array.map(pipe(all, Array.drop(input.offset), Array.take(input.logLimit)), log => ({
				...log,
				message: textWindow(log.message, input.textOffset, input.textLimit).text,
				whole: log.message
			})),
			log => log.message.length
		)
		return Result.succeed({
			...metadata,
			logs: Option.some(Array.map(logs, log => Struct.omit(log, ['whole']))),
			nextOffset: Option.liftPredicate(input.offset + logs.length, next => next < all.length),
			nextTextOffset: Option.liftPredicate(input.textOffset + input.textLimit, next =>
				Array.some(logs, log => log.whole.length > next)
			),
			spans: []
		})
	}
	return Result.succeed({
		...metadata,
		...Struct.pick(answer, ['nextOffset']),
		nextTextOffset: Option.liftPredicate(input.textOffset + input.textLimit, next =>
			Array.some(spans, span => Option.exists(span.error, error => error.length > next))
		),
		spans: Array.map(spans, span => ({
			...Struct.omit(span, ['attrs', 'logs', 'error']),
			error: Option.map(span.error, error => sliceWhole(error, input.textOffset, input.textLimit))
		}))
	})
}

function logPage(answer: LogsAnswer, input: typeof ToolContracts.tools.search_logs.parametersSchema.Type) {
	const logs = withinBudget(
		Array.map(answer.logs, log => {
			const message = textWindow(log.message, input.textOffset, input.textLimit)
			const attrs = attributeWindow(
				Option.getOrElse(log.attrs, () => ({})),
				input
			)
			return {
				...Struct.omit(log, ['attrs', 'message']),
				...Struct.omit(attrs, ['attributes']),
				...Struct.omit(message, ['text']),
				attrs: Option.some(attrs.attributes),
				message: message.text,
				nextTextOffset: Option.orElse(message.nextTextOffset, () => attrs.nextTextOffset)
			}
		}),
		log =>
			log.message.length +
			Number.sumAll(Array.map(Record.values(Option.getOrElse(log.attrs, () => ({}))), value => `${value}`.length))
	)
	// A page cut short by the budget continues after its last row, as a full one does.
	return {
		logs,
		nextCursor: Boolean.match(logs.length < answer.logs.length, {
			onFalse: () => answer.nextCursor,
			onTrue: () => Option.map(Array.last(logs), log => ({id: log.id, time: log.at}))
		})
	}
}

export const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return ToolContracts.of({
			check_ingestion: input => Effect.map(telemetry.checkIngestion(), answer => ingestionResult(answer, input)),
			list_operations: input => Effect.map(telemetry.listOperations(input), answer => operationPage(answer, input)),
			measure_latency: telemetry.measureLatency,
			read_trace: input =>
				Effect.flatMap(telemetry.readTrace(input, input.offset, input.span, input.section === 'logs'), answer =>
					Effect.fromResult<typeof ToolContracts.tools.read_trace.successSchema.Type, TelemetryError>(
						traceResult(answer, input)
					)
				),
			search_logs: input => Effect.map(telemetry.searchLogs(input), answer => logPage(answer, input)),
			search_traces: telemetry.findTraces
		})
	})
)
