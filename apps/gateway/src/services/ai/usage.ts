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
	Order,
	Path,
	Record,
	Result,
	Schema,
	Semaphore,
	String
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {AiUsageEntry, AiUsageLine, Usage} from '#services/ai/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

const OLD_PREFIX = 'ai-usage/'

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

function totals(rows: AiUsageEntry[]) {
	return Array.reduce(rows, {costUsd: 0, unknownCostCalls: 0}, (sum, row) => ({
		costUsd: sum.costUsd + (row.costUsd ?? 0),
		unknownCostCalls:
			sum.unknownCostCalls + Boolean.match(row.costSource === 'unknown', {onFalse: () => 0, onTrue: () => 1})
	}))
}
function grouped(rows: AiUsageEntry[], key: (entry: AiUsageEntry) => string) {
	return Array.map(Record.toEntries(Array.groupBy(rows, key)), entry => ({name: entry[0], ...totals(entry[1])}))
}
export function report(entries: AiUsageEntry[], range: UsageRange) {
	const selected = Array.filter(entries, entry => entry.at >= range.from && entry.at < range.to)
	function bucket(entry: AiUsageEntry) {
		return Math.floor(entry.at / range.size) * range.size
	}
	return {
		byProvider: grouped(selected, entry => entry.provider),
		series: Array.sort(
			Array.map(Record.values(Array.groupBy(selected, entry => `${bucket(entry)}`)), group => ({
				at: bucket(group[0]),
				byProvider: grouped(group, entry => entry.provider)
			})),
			Order.mapInput(Number.Order, (entry: {at: number}) => entry.at)
		)
	}
}

function dayOf(at: number) {
	return DateTime.formatIsoDateUtc(DateTime.makeUnsafe(at))
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
		const kv = yield* KeyValueStore.KeyValueStore
		const root = path.join(directory, 'ai-usage')
		const lock = yield* Semaphore.make(1)
		const months = MutableHashMap.empty<string, MutableList.MutableList<AiUsageEntry>>()
		const loaded = MutableHashSet.empty<string>()
		const known = MutableHashSet.empty<string>()

		function directoryOf(person: string) {
			return path.join(root, encodeURIComponent(person))
		}
		function fileOf(person: string, day: string) {
			return path.join(directoryOf(person), `${day}.ndjson`)
		}

		const remember = Effect.fnUntraced(function* (person: string) {
			if (MutableHashSet.has(known, person)) return
			yield* fs.makeDirectory(directoryOf(person), {mode: 0o700, recursive: true})
			MutableHashSet.add(known, person)
		})

		// Runs once per process: each stored monthly array becomes day files, and its key is removed after they are written.
		const migrate = yield* Effect.cached(
			Effect.gen(function* () {
				yield* Effect.forEach(
					Array.filter(yield* kv.keys, key => String.startsWith(OLD_PREFIX)(key)),
					Effect.fnUntraced(function* (key) {
						const text = yield* kv.get(key)
						if (text === undefined) return
						const entries = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(AiUsageEntry)))(text)
						const person = Option.getOrThrow(Array.head(String.split('/')(String.slice(OLD_PREFIX.length)(key))))
						yield* Effect.forEach(
							Record.toEntries(Array.groupBy(entries, entry => dayOf(entry.at))),
							day =>
								Effect.gen(function* () {
									const file = fileOf(person, day[0])
									// An interrupted conversion wrote this day before the key was removed.
									if (yield* fs.exists(file)) return
									yield* remember(person)
									yield* fs.writeFileString(
										`${file}.tmp`,
										`${Array.join(
											Array.map(day[1], entry => Schema.encodeSync(AiUsageLine)(entry)),
											'\n'
										)}\n`,
										{mode: 0o600}
									)
									yield* fs.rename(`${file}.tmp`, file)
								}),
							{concurrency: 1, discard: true}
						)
						yield* kv.remove(key)
					}),
					{concurrency: 1, discard: true}
				)
			})
		)

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
					Effect.gen(function* () {
						const text = yield* fs.readFileString(path.join(personDirectory, file))
						const lines = Array.filter(String.split(/\r?\n/u)(text), String.isNonEmpty)
						MutableList.appendAll(
							entries,
							yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(AiUsageEntry)))(
								`[${Array.join(lines, ',')}]`
							)
						)
					}),
				{concurrency: 1, discard: true}
			)
			MutableHashMap.set(months, key, entries)
			MutableHashSet.add(loaded, key)
		})

		const save = Effect.fnUntraced(function* (person: string, entry: AiUsageEntry) {
			yield* migrate
			yield* lock.withPermit(
				Effect.gen(function* () {
					const day = dayOf(entry.at)
					yield* remember(person)
					yield* fs.writeFileString(fileOf(person, day), `${yield* Schema.encodeEffect(AiUsageLine)(entry)}\n`, {
						flag: 'a',
						mode: 0o600
					})
					Option.match(MutableHashMap.get(months, `${person}/${String.slice(0, 7)(day)}`), {
						onNone: () => undefined,
						onSome: month => MutableList.append(month, entry)
					})
				})
			)
		})

		const read = Effect.fnUntraced(function* (person: string, range: UsageRange) {
			yield* migrate
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
