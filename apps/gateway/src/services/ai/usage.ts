import {
	Array,
	Boolean,
	DateTime,
	Effect,
	FileSystem,
	MutableHashMap,
	MutableHashSet,
	MutableList,
	Number,
	Option,
	Path,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {Ndjson} from 'effect/encoding'

import {report} from '#services/ai/lib/utils.ts'
import {AiUsageEntry, AiUsageLine, Usage} from '#services/ai/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

export function readUsage(text: string, entry: AiUsageEntry) {
	if (String.isEmpty(String.trim(text)) || text === '[DONE]') return Result.succeed(entry)
	return Result.map(Schema.decodeResult(Schema.fromJsonString(Usage))(text), decoded => {
		const usage = {...decoded.message?.usage, ...decoded.usage}
		const cacheReadTokens =
			usage.cache_read_input_tokens ?? decoded.usage?.prompt_tokens_details?.cached_tokens ?? entry.cacheReadTokens
		const cacheWriteTokens =
			usage.cache_creation_input_tokens ??
			decoded.usage?.prompt_tokens_details?.cache_write_tokens ??
			entry.cacheWriteTokens
		return {
			...entry,
			cacheReadTokens,
			cacheWriteTokens,
			// Input is stored without cached tokens, as Anthropic's messages report it; chat completions' prompt_tokens include them, whichever provider serves the shape.
			inputTokens:
				usage.input_tokens ??
				Option.match(Option.fromUndefinedOr(usage.prompt_tokens), {
					onNone: () => entry.inputTokens,
					onSome: prompt => Number.max(0, prompt - cacheReadTokens - cacheWriteTokens)
				}),
			model: decoded.model ?? decoded.message?.model ?? entry.model,
			outputTokens: usage.output_tokens ?? usage.completion_tokens ?? entry.outputTokens,
			...Boolean.match(decoded.usage?.cost !== undefined || decoded.cost !== undefined, {
				onFalse: () => ({}),
				onTrue: () => ({costSource: 'provider' as const, costUsd: decoded.usage?.cost ?? decoded.cost})
			})
		} satisfies AiUsageEntry
	})
}

function monthsOf(range: UsageRange) {
	const months = MutableList.make<string>()
	const cursor = {date: DateTime.startOf(DateTime.makeUnsafe(range.from), 'month')}
	while (DateTime.toEpochMillis(cursor.date) < range.to) {
		MutableList.append(months, String.slice(0, 7)(DateTime.formatIsoDateUtc(cursor.date)))
		cursor.date = DateTime.add(cursor.date, {months: 1})
	}
	return MutableList.toArray(months)
}

// One append-only NDJSON file per person and day, with each month read once into memory for reports.
export function makeUsage(directory: string) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const root = path.join(directory, 'ai-usage')
		const lock = yield* Semaphore.make(1)
		const months = MutableHashMap.empty<string, MutableList.MutableList<AiUsageEntry>>()
		const loaded = MutableHashSet.empty<string>()
		const known = MutableHashSet.empty<string>()

		function directoryOf(person: string) {
			return path.join(root, encodeURIComponent(person))
		}
		const load = Effect.fnUntraced(function* (person: string, month: string) {
			const key = `${person}/${month}`
			if (MutableHashSet.has(loaded, key)) return
			const personDirectory = directoryOf(person)
			const files = yield* Boolean.match(yield* fs.exists(personDirectory), {
				onFalse: () => Effect.succeed(Array.empty<string>()),
				onTrue: () => fs.readDirectory(personDirectory)
			})
			const entries = MutableList.make<AiUsageEntry>()
			yield* Effect.forEach(
				Array.sort(
					Array.filter(files, file => String.startsWith(`${month}-`)(file) && String.endsWith('.ndjson')(file)),
					String.Order
				),
				file =>
					pipe(
						fs.stream(path.join(personDirectory, file)),
						Stream.pipeThroughChannel(Ndjson.decodeSchema(AiUsageEntry)({ignoreEmptyLines: true})),
						Stream.runForEach(entry =>
							Effect.sync(() => {
								MutableList.append(entries, entry)
							})
						)
					),
				{concurrency: 1, discard: true}
			)
			MutableHashMap.set(months, key, entries)
			MutableHashSet.add(loaded, key)
		})

		const save = Effect.fnUntraced(function* (person: string, entry: AiUsageEntry) {
			yield* lock.withPermit(
				Effect.gen(function* () {
					const day = DateTime.formatIsoDateUtc(DateTime.makeUnsafe(entry.at))
					if (!MutableHashSet.has(known, person)) {
						yield* fs.makeDirectory(directoryOf(person), {mode: 0o700, recursive: true})
						MutableHashSet.add(known, person)
					}
					yield* fs.writeFileString(
						path.join(directoryOf(person), `${day}.ndjson`),
						`${yield* Schema.encodeEffect(AiUsageLine)(entry)}\n`,
						{flag: 'a', mode: 0o600}
					)
					Option.match(MutableHashMap.get(months, `${person}/${String.slice(0, 7)(day)}`), {
						onNone: () => undefined,
						onSome: month => MutableList.append(month, entry)
					})
				})
			)
		})

		const read = Effect.fnUntraced(function* (person: string, range: UsageRange) {
			return yield* lock.withPermit(
				Effect.gen(function* () {
					yield* Effect.forEach(monthsOf(range), month => load(person, month), {concurrency: 1, discard: true})
					return report(
						Array.flatMap(monthsOf(range), month =>
							Option.match(MutableHashMap.get(months, `${person}/${month}`), {
								onNone: () => Array.empty<AiUsageEntry>(),
								onSome: MutableList.toArray
							})
						),
						range
					)
				})
			)
		})

		return {read, save}
	})
}
