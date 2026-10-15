import {
	Array,
	Boolean,
	DateTime,
	Function,
	HashSet,
	Number,
	Option,
	Predicate,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import type {Event, Transcript, Usage} from '#schema'

function usageRecords(records: Transcript) {
	const claude = pipe(
		records,
		Array.filter(record => record.type === 'assistant' && Predicate.isNotUndefined(record.message?.usage)),
		Array.groupBy(record => record.message?.id ?? record.timestamp ?? ''),
		Record.values,
		Array.flatMap(group => Option.toArray(Option.fromUndefinedOr(Array.lastNonEmpty(group).message?.usage)))
	)
	if (Array.isReadonlyArrayNonEmpty(claude)) return claude
	const codex = Array.flatMap(records, record => {
		if (record.type !== 'token_usage_record') return []
		return Option.toArray(Option.fromUndefinedOr(record.payload?.usage))
	})
	if (Array.isReadonlyArrayNonEmpty(codex)) return codex
	return pipe(
		records,
		Array.flatMap(record => Option.toArray(Option.fromNullishOr(record.payload?.info?.total_token_usage))),
		Array.last,
		Option.toArray
	)
}

function sum(values: number[]) {
	return Array.match(values, {onEmpty: Function.constUndefined, onNonEmpty: Number.sumAll})
}

export function measure(records: Transcript, available = true) {
	const toolMessageIds = pipe(
		records,
		Array.filter(
			record =>
				record.type === 'assistant' &&
				Predicate.isNotUndefined(record.message) &&
				(record.message.stop_reason === 'tool_use' ||
					(!Predicate.isString(record.message.content) &&
						Array.some(record.message.content, block => block.type === 'tool_use')))
		),
		Array.flatMap(record => Option.toArray(Option.fromUndefinedOr(record.message?.id))),
		HashSet.fromIterable
	)
	const trace = Array.flatMap(records, (record, index) => {
		if (record.message && !Predicate.isString(record.message.content)) {
			const textKind = Boolean.match(
				record.message.stop_reason === 'tool_use' ||
					(Predicate.isNotUndefined(record.message.id) && HashSet.has(toolMessageIds, record.message.id)) ||
					Array.some(record.message.content, block => block.type === 'tool_use'),
				{onFalse: () => 'reply' as const, onTrue: () => 'commentary' as const}
			)
			return Array.flatMap(record.message.content, block => {
				if (block.type === 'tool_use') {
					return Array.of<Event>({
						failed: undefined,
						id: block.id ?? `${index}`,
						kind: 'call',
						name: block.name ?? '',
						text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(block.input ?? {}),
						timestamp: record.timestamp
					})
				}
				if (block.type === 'tool_result') {
					return Array.of<Event>({
						failed: block.is_error,
						id: block.tool_use_id ?? `${index}`,
						kind: 'result',
						name: '',
						text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(block.content ?? ''),
						timestamp: record.timestamp
					})
				}
				if (block.type === 'text' && record.type === 'assistant') {
					return Array.of<Event>({
						failed: undefined,
						id: `${index}`,
						kind: textKind,
						name: '',
						text: block.text ?? '',
						timestamp: record.timestamp
					})
				}
				return Array.empty<Event>()
			})
		}
		if (!record.payload) return Array.empty<Event>()
		const shared = {
			failed: undefined,
			id: record.payload.call_id ?? `${index}`,
			name: record.payload.name ?? '',
			timestamp: record.timestamp
		}
		if (record.payload.type === 'function_call' || record.payload.type === 'custom_tool_call') {
			return Array.of<Event>({...shared, kind: 'call', text: record.payload.arguments ?? record.payload.input ?? ''})
		}
		if (record.payload.type === 'function_call_output' || record.payload.type === 'custom_tool_call_output') {
			return Array.of<Event>({
				...shared,
				kind: 'result',
				text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(record.payload.output ?? '')
			})
		}
		if (record.payload.type === 'message' && record.payload.role === 'assistant') {
			return Array.of<Event>({
				...shared,
				kind: Boolean.match(record.payload.phase === 'commentary' || record.payload.channel === 'commentary', {
					onFalse: () => 'reply' as const,
					onTrue: () => 'commentary' as const
				}),
				text: pipe(
					record.payload.content ?? [],
					Array.map(block => block.text ?? ''),
					Array.join('\n')
				)
			})
		}
		return Array.empty<Event>()
	})
	const usage = usageRecords(records)
	function total(field: Exclude<keyof Usage, 'output_tokens_details'>) {
		return sum(Array.flatMap(usage, value => Option.toArray(Option.fromUndefinedOr(value[field]))))
	}
	const calls = Array.filter(trace, event => event.kind === 'call')
	const results = Array.filter(trace, event => event.kind === 'result')
	const counted = available && !Array.some(calls, event => Option.isSome(String.match(/(?:^|\.)exec$/u)(event.name)))
	const durations = Array.flatMap(calls, call => {
		const result = Option.getOrUndefined(Array.findFirst(results, item => item.id === call.id))
		if (!result || Predicate.isUndefined(call.timestamp) || Predicate.isUndefined(result.timestamp)) return []
		return Option.toArray(
			Option.zipWith(
				DateTime.make(call.timestamp),
				DateTime.make(result.timestamp),
				(start, end) => DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start)
			)
		)
	})
	const replies = Array.filter(trace, event => event.kind === 'reply')
	const last = Option.getOrUndefined(Array.last(replies))
	return {
		cacheWriteTokens: total('cache_creation_input_tokens') ?? total('cache_write_input_tokens'),
		cachedInputTokens: total('cache_read_input_tokens') ?? total('cached_input_tokens'),
		editCalls: Boolean.match(counted, {
			onFalse: Function.constUndefined,
			onTrue: () =>
				Array.countBy(calls, event =>
					Option.isSome(String.match(/apply_patch|^(?:Edit|Write|MultiEdit)$/u)(event.name))
				)
		}),
		explicitToolFailures: Boolean.match(available, {
			onFalse: Function.constUndefined,
			onTrue: () => Array.countBy(results, event => event.failed === true)
		}),
		inputTokens: total('input_tokens'),
		outputTokens: total('output_tokens'),
		reasoningTokens: sum(
			Array.flatMap(usage, value =>
				Option.toArray(
					Option.fromUndefinedOr(value.reasoning_output_tokens ?? value.output_tokens_details?.thinking_tokens)
				)
			)
		),
		repeatedReadRequests: Boolean.match(counted, {
			onFalse: Function.constUndefined,
			onTrue: () =>
				pipe(
					calls,
					Array.filter(event => Option.isSome(String.match(/Read|read_file/u)(event.name))),
					Array.groupBy(event => event.text),
					Record.values,
					Array.reduce(0, (count, group) => count + group.length - 1)
				)
		}),
		reply: pipe(
			replies,
			Array.filter(event => event.id === last?.id),
			Array.map(event => event.text),
			Array.join('\n')
		),
		toolCalls: Boolean.match(available, {onFalse: Function.constUndefined, onTrue: () => calls.length}),
		toolMilliseconds: sum(durations),
		toolResultCharacters: Boolean.match(available, {
			onFalse: Function.constUndefined,
			onTrue: () => Array.reduce(results, 0, (characters, event) => characters + event.text.length)
		}),
		trace,
		unclassifiedToolResults: Boolean.match(available, {
			onFalse: Function.constUndefined,
			onTrue: () => Array.countBy(results, event => Predicate.isUndefined(event.failed))
		})
	}
}

export function blindText(text: string, directory: string) {
	return pipe(text, String.replaceAll(directory, 'EVAL'), String.replaceAll(/\b[\w-]+-(?:claude|codex)\b/gu, 'RUN'))
}
