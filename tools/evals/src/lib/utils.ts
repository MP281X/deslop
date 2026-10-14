import {Array, DateTime, HashSet, Number, Option, Predicate, Record, Schema, String, pipe} from 'effect'

import type {Block, Event, Transcript, Usage} from '#schema'

function usageRecords(records: Transcript): Usage[] {
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
	const trace = Array.flatMap(records, (record, index): Event[] => {
		const timestamp = Option.getOrNull(Option.fromUndefinedOr(record.timestamp))
		const message = record.message
		if (message && !Predicate.isString(message.content)) {
			const textKind =
				message.stop_reason === 'tool_use' ||
				(Predicate.isNotUndefined(message.id) && HashSet.has(toolMessageIds, message.id)) ||
				Array.some(message.content, block => block.type === 'tool_use')
					? 'commentary'
					: 'reply'
			return Array.flatMap(message.content, (block: Block): Event[] => {
				const shared = {failed: Option.getOrNull(Option.none()), timestamp}
				if (block.type === 'tool_use') {
					return [
						{
							...shared,
							id: block.id ?? `${index}`,
							kind: 'call',
							name: block.name ?? '',
							text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(block.input ?? {})
						}
					]
				}
				if (block.type === 'tool_result') {
					return [
						{
							...shared,
							failed: block.is_error ?? Option.getOrNull(Option.none()),
							id: block.tool_use_id ?? `${index}`,
							kind: 'result',
							name: '',
							text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(block.content ?? '')
						}
					]
				}
				if (block.type === 'text' && record.type === 'assistant') {
					return [{...shared, id: `${index}`, kind: textKind, name: '', text: block.text ?? ''}]
				}
				return []
			})
		}
		const payload = record.payload
		if (!payload) return []
		const shared = {
			failed: Option.getOrNull(Option.none()),
			id: payload.call_id ?? `${index}`,
			name: payload.name ?? '',
			timestamp
		}
		if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
			return [{...shared, kind: 'call', text: payload.arguments ?? payload.input ?? ''}]
		}
		if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
			return [
				{
					...shared,
					kind: 'result',
					text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(payload.output ?? '')
				}
			]
		}
		if (payload.type === 'message' && payload.role === 'assistant') {
			return [
				{
					...shared,
					kind: payload.phase === 'commentary' || payload.channel === 'commentary' ? 'commentary' : 'reply',
					text: pipe(
						payload.content ?? [],
						Array.map(block => block.text ?? ''),
						Array.join('\n')
					)
				}
			]
		}
		return []
	})
	const usage = usageRecords(records)
	function total(field: Exclude<keyof Usage, 'output_tokens_details'>) {
		const values = Array.flatMap(usage, value => Option.toArray(Option.fromUndefinedOr(value[field])))
		if (Array.isReadonlyArrayEmpty(values)) return Option.getOrNull(Option.none())
		return Array.reduce(values, 0, Number.sum)
	}
	const calls = Array.filter(trace, event => event.kind === 'call')
	const wrappedCalls = Array.some(calls, event => Option.isSome(String.match(/(?:^|\.)exec$/u)(event.name)))
	const results = Array.filter(trace, event => event.kind === 'result')
	const durations = Array.flatMap(calls, call => {
		const result = Option.getOrUndefined(Array.findFirst(results, item => item.id === call.id))
		if (!result || Predicate.isNull(call.timestamp) || Predicate.isNull(result.timestamp)) return []
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
	const reasoning = Array.flatMap(usage, value =>
		Option.toArray(
			Option.fromUndefinedOr(value.reasoning_output_tokens ?? value.output_tokens_details?.thinking_tokens)
		)
	)
	return {
		cacheWriteTokens: total('cache_creation_input_tokens') ?? total('cache_write_input_tokens'),
		cachedInputTokens: total('cache_read_input_tokens') ?? total('cached_input_tokens'),
		correctiveEdits: Option.getOrNull(Option.none()),
		editCalls:
			available && !wrappedCalls
				? Array.countBy(calls, event =>
						Option.isSome(String.match(/apply_patch|^(?:Edit|Write|MultiEdit)$/u)(event.name))
					)
				: Option.getOrNull(Option.none()),
		explicitToolFailures: available
			? Array.countBy(results, event => event.failed === true)
			: Option.getOrNull(Option.none()),
		firstPassReady: Option.getOrNull(Option.none()),
		inputTokens: total('input_tokens'),
		outputTokens: total('output_tokens'),
		reasoningTokens: Array.isReadonlyArrayNonEmpty(reasoning)
			? Array.reduce(reasoning, 0, Number.sum)
			: Option.getOrNull(Option.none()),
		repeatedReadRequests:
			available && !wrappedCalls
				? pipe(
						calls,
						Array.filter(event => Option.isSome(String.match(/Read|read_file/u)(event.name))),
						Array.groupBy(event => event.text),
						Record.values,
						Array.reduce(0, (sum, group) => sum + group.length - 1)
					)
				: Option.getOrNull(Option.none()),
		reply: pipe(
			replies,
			Array.filter(event => event.id === last?.id),
			Array.map(event => event.text),
			Array.join('\n')
		),
		toolCalls: available ? calls.length : Option.getOrNull(Option.none()),
		toolMilliseconds: Array.isReadonlyArrayNonEmpty(durations)
			? Array.reduce(durations, 0, Number.sum)
			: Option.getOrNull(Option.none()),
		toolResultCharacters: available
			? Array.reduce(results, 0, (sum, event) => sum + event.text.length)
			: Option.getOrNull(Option.none()),
		trace,
		unclassifiedToolResults: available
			? Array.countBy(results, event => Predicate.isNull(event.failed))
			: Option.getOrNull(Option.none())
	}
}

export function blindText(text: string, directory: string) {
	return pipe(text, String.replaceAll(directory, 'EVAL'), String.replaceAll(/\b[\w-]+-(?:claude|codex)\b/gu, 'RUN'))
}
