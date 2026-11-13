import {Array, Boolean, Effect, Option, Order, Predicate, Record, Result, String, Struct, pipe} from 'effect'

import {TelemetryError} from '#services/telemetry/schema.ts'
import type {AppName, IngestionAnswer, LogsAnswer, OperationRow, OperationsAnswer} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {ToolContracts} from '#tools/contracts.ts'

function textWindow(text: string, offset: number, limit: number) {
	return {
		nextTextOffset: Option.liftPredicate(offset + limit, next => next < text.length),
		text: String.slice(offset, offset + limit)(text)
	}
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
				Option.match(input.attribute, {onNone: () => true, onSome: key => entry[0] === key}) &&
				Option.match(input.attributeCursor, {onNone: () => true, onSome: cursor => entry[0] > cursor})
		)
	)
	const page = Array.take(entries, 20)
	return {
		attributes: pipe(
			page,
			Array.map(entry => {
				if (Predicate.isString(entry[1])) {
					return [entry[0], String.slice(input.textOffset, input.textOffset + input.textLimit)(entry[1])] as const
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
			Option.match(input.app, {onNone: () => true, onSome: app => service.app === app})
		)
	}
}

function operationPage(
	answer: OperationsAnswer,
	input: typeof ToolContracts.tools.list_operations.parametersSchema.Type
) {
	const remaining = pipe(
		answer.apps,
		Array.flatMap(app =>
			Array.map(app.operations, operation => ({
				app: app.app,
				key: `${pipe(
					operation.failures,
					Option.exists(count => count > 0),
					Boolean.match({onFalse: () => '1', onTrue: () => '0'})
				)}\t${app.app}\t${operation.name}\t${Option.getOrElse(operation.side, () => '')}`,
				operation
			}))
		),
		Array.sort(Order.mapInput(Order.String, (row: {app: AppName; key: string; operation: OperationRow}) => row.key)),
		Array.filter(
			row =>
				Option.match(input.operation, {onNone: () => true, onSome: name => row.operation.name === name}) &&
				Option.match(input.cursor, {onNone: () => true, onSome: cursor => row.key > cursor})
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
		const attrs = Option.getOrElse(Option.getOrThrow(Array.head(spans)).attrs, () => ({}))
		if (Option.exists(input.attribute, key => !Record.has(attrs, key))) {
			return Result.fail(
				TelemetryError.make({
					message: `Unknown attribute ${Option.getOrThrow(input.attribute)}; valid attributes: ${Array.join(Record.keys(attrs), ', ')}.`
				})
			)
		}
		const window = attributeWindow(attrs, input)
		return Result.succeed({...metadata, ...window, attributes: Option.some(window.attributes), spans: []})
	}
	if (input.section === 'logs') {
		const all = Boolean.match(Option.isNone(input.span), {
			onFalse: () => Array.flatMap(spans, span => Option.getOrElse(span.logs, () => [])),
			onTrue: () => [
				...Option.getOrElse(answer.logs, () => []),
				...Array.flatMap(spans, span => Option.getOrElse(span.logs, () => []))
			]
		})
		const logs = pipe(all, Array.drop(input.offset), Array.take(input.logLimit))
		return Result.succeed({
			...metadata,
			logs: Option.some(
				Array.map(logs, log => ({...log, message: textWindow(log.message, input.textOffset, input.textLimit).text}))
			),
			nextOffset: Option.liftPredicate(input.offset + input.logLimit, next => next < all.length),
			nextTextOffset: Option.liftPredicate(input.textOffset + input.textLimit, next =>
				Array.some(logs, log => log.message.length > next)
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
			error: Option.map(span.error, String.slice(input.textOffset, input.textOffset + input.textLimit))
		}))
	})
}

function logPage(answer: LogsAnswer, input: typeof ToolContracts.tools.search_logs.parametersSchema.Type) {
	return {
		...answer,
		logs: Array.map(answer.logs, log => {
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
