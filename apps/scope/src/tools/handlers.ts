import {Array, Boolean, Effect, Option, Order, Predicate, Record, Result, String, Struct, pipe} from 'effect'

import {TelemetryError} from '#services/telemetry/schema.ts'
import type {IngestionAnswer, LogsAnswer, OperationRow, OperationsAnswer} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {ToolContracts} from '#tools/contracts.ts'

function textWindow(text: string, offset: number, limit: number) {
	return {
		text: String.slice(offset, offset + limit)(text),
		...Boolean.match(offset + limit < text.length, {
			onFalse: () => ({}),
			onTrue: () => ({nextTextOffset: offset + limit})
		})
	}
}

function attributeWindow(
	attrs: Readonly<Record<string, string | number | boolean>>,
	input: {attribute?: string; attributeCursor?: string; textOffset: number; textLimit: number}
) {
	const entries = pipe(
		attrs,
		Record.toEntries,
		Array.sort(Order.mapInput(Order.String, (entry: readonly [string, string | number | boolean]) => entry[0])),
		Array.filter(
			entry =>
				(input.attribute === undefined || entry[0] === input.attribute) &&
				(input.attributeCursor === undefined || entry[0] > input.attributeCursor)
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
		...pipe(
			page,
			Array.last,
			Option.filter(() => entries.length > page.length),
			Option.match({onNone: () => ({}), onSome: entry => ({nextAttribute: entry[0]})})
		),
		...pipe(page, Array.some(entry => Predicate.isString(entry[1]) && entry[1].length > input.textOffset + input.textLimit), pipelineSubject1681 => Boolean.match(pipelineSubject1681, {onFalse: () => ({}), onTrue: () => ({nextTextOffset: input.textOffset + input.textLimit})}))
	}
}

function ingestionResult(
	answer: IngestionAnswer,
	input: typeof ToolContracts.tools.check_ingestion.parametersSchema.Type
) {
	return {
		...answer,
		services: pipe(
			answer.services,
			Array.filter(service => input.app === undefined || service.app === input.app),
			Array.map(service => ({
				...Struct.omit(service, ['runStarted']),
				...Boolean.match(service.runStarted === '1970-01-01T00:00:00.000Z', {
					onFalse: () => ({runStarted: service.runStarted}),
					onTrue: () => ({})
				})
			}))
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
				key: `${Boolean.match((operation.failures ?? 0) > 0, {onFalse: () => '1', onTrue: () => '0'})}\t${app.app}\t${operation.name}\t${operation.side ?? ''}`,
				operation
			}))
		),
		Array.sort(Order.mapInput(Order.String, (row: {app: string; key: string; operation: OperationRow}) => row.key)),
		Array.filter(
			row =>
				(input.operation === undefined || row.operation.name === input.operation) &&
				(input.cursor === undefined || row.key > input.cursor)
		)
	)
	const page = Array.take(remaining, input.limit)
	const byApp = Array.groupBy(page, row => row.app)
	return {
		apps: Array.flatMap(answer.apps, app =>
			pipe(byApp, pipelineSubject3332 => Record.get(pipelineSubject3332, app.app), pipelineSubject3319 => Option.match(pipelineSubject3319, {
				onNone: () => [],
				onSome: rows => [{app: app.app, operations: Array.map(rows, row => row.operation)}]
			}))
		),
		...pipe(
			page,
			Array.last,
			Option.filter(() => remaining.length > input.limit),
			Option.match({onNone: () => ({}), onSome: row => ({nextCursor: row.key})})
		)
	}
}

function traceResult(
	answer: Effect.Success<ReturnType<typeof Telemetry.Service.readTrace>>,
	input: typeof ToolContracts.tools.read_trace.parametersSchema.Type
) {
	const metadata = Struct.omit(answer, ['spans', 'logs', 'nextOffset'])
	const spans = answer.spans
	if (input.span !== undefined && Array.isReadonlyArrayEmpty(spans)) {
		return Result.fail(
			TelemetryError.make({message: 'This span is not in this trace page; omit span and use nextOffset to locate it.'})
		)
	}
	if (input.section === 'attributes') {
		if (input.span === undefined) {
			return Result.fail(
				TelemetryError.make({message: 'section=attributes requires span; choose a span id from read_trace.'})
			)
		}
		const attrs = Option.getOrThrow(Array.head(spans)).attrs ?? {}
		if (input.attribute !== undefined && !Record.has(attrs, input.attribute)) {
			return Result.fail(
				TelemetryError.make({
					message: `Unknown attribute ${input.attribute}; valid attributes: ${Array.join(Record.keys(attrs), ', ')}.`
				})
			)
		}
		return Result.succeed({...metadata, ...attributeWindow(attrs, input), spans: []})
	}
	if (input.section === 'logs') {
		const all = Boolean.match(input.span === undefined, {
			onFalse: () => Array.flatMap(spans, span => span.logs ?? []),
			onTrue: () => [...(answer.logs ?? []), ...Array.flatMap(spans, span => span.logs ?? [])]
		})
		const logs = pipe(all, Array.drop(input.offset), Array.take(input.logLimit))
		return Result.succeed({
			...metadata,
			logs: Array.map(logs, log => ({
				...log,
				message: textWindow(log.message, input.textOffset, input.textLimit).text
			})),
			spans: [],
			...Boolean.match(input.offset + input.logLimit < all.length, {
				onFalse: () => ({}),
				onTrue: () => ({nextOffset: input.offset + input.logLimit})
			}),
			...pipe(logs, Array.some(log => log.message.length > input.textOffset + input.textLimit), pipelineSubject5449 => Boolean.match(pipelineSubject5449, {onFalse: () => ({}), onTrue: () => ({nextTextOffset: input.textOffset + input.textLimit})}))
		})
	}
	return Result.succeed({
		...metadata,
		...Struct.pick(answer, ['nextOffset']),
		spans: Array.map(spans, span => ({
			...Struct.omit(span, ['attrs', 'logs', 'error']),
			...Option.match(Option.fromUndefinedOr(span.error), {
				onNone: () => ({}),
				onSome: error => ({error: String.slice(input.textOffset, input.textOffset + input.textLimit)(error)})
			})
		})),
		...pipe(spans, Array.some(span => (span.error?.length ?? 0) > input.textOffset + input.textLimit), pipelineSubject6036 => Boolean.match(pipelineSubject6036, {onFalse: () => ({}), onTrue: () => ({nextTextOffset: input.textOffset + input.textLimit})}))
	})
}

function logPage(answer: LogsAnswer, input: typeof ToolContracts.tools.search_logs.parametersSchema.Type) {
	return {
		...answer,
		logs: Array.map(answer.logs, log => {
			const message = textWindow(log.message, input.textOffset, input.textLimit)
			const attrs = attributeWindow(log.attrs ?? {}, input)
			return {
				...Struct.omit(log, ['attrs', 'message']),
				...Struct.omit(attrs, ['attributes']),
				...Struct.omit(message, ['text']),
				attrs: attrs.attributes,
				message: message.text
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
