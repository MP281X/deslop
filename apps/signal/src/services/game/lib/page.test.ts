import {assert, it} from '@effect/vitest'

import {Array, Effect, Option} from 'effect'

import {readFeed} from '#services/game/lib/page.ts'
import type {Entry, Experience} from '#services/game/schema.ts'

function event(id: number, tick: number) {
	return {actor: 2, id, kind: 'action', team: 0, text: 'Moved.', tick, x: 0, z: 0} satisfies Experience
}

function round(sequence: number) {
	return {
		commands: [],
		notices: [],
		observation: '',
		round: sequence,
		status: 'done',
		team: 0,
		text: 'Survey.',
		tick: sequence * 600
	} satisfies Entry
}

function readers(events: readonly Experience[], rounds: readonly Entry[]) {
	return {
		history: (before: Option.Option<number>, at: number) =>
			Effect.succeed(
				Array.takeRight(
					Array.filter(
						events,
						entry =>
							(at < 0 || entry.tick <= at) &&
							Option.match(before, {onNone: () => true, onSome: cursor => entry.id < cursor})
					),
					100
				)
			),
		thread: (_team: number, before: Option.Option<number>) =>
			Effect.succeed(
				Array.takeRight(
					Array.filter(rounds, entry =>
						Option.match(before, {onNone: () => true, onSome: cursor => entry.round < cursor})
					),
					20
				)
			)
	}
}

it.effect(
	'completes a boundary containing more than one event page without losing Core decisions',
	Effect.fnUntraced(function* () {
		const events = Array.map(Array.range(1, 301), id => event(id, 20))
		const page = yield* readFeed(readers(events, [{...round(1), tick: 20}]), [0], -1)
		assert.strictEqual(page.entries.length, 302)
		assert.strictEqual(page.before, 19)
		assert.strictEqual(
			Array.countBy(page.entries, entry => entry.kind === 'event'),
			301
		)
		assert.strictEqual(
			Array.countBy(page.entries, entry => entry.kind === 'core'),
			1
		)
		assert.deepStrictEqual((yield* readFeed(readers(events, []), [0], page.before)).entries, [])
	})
)

it.effect(
	'pages differently paced histories and Core conversations into disjoint complete time windows',
	Effect.fnUntraced(function* () {
		const read = readers(
			Array.map(Array.range(1, 350), id => event(id, id * 60)),
			Array.map(Array.range(1, 40), round)
		)
		const collected = {...(yield* readFeed(read, [0], -1))}
		while (collected.before >= 0) {
			const page = yield* readFeed(read, [0], collected.before)
			collected.entries = [...page.entries, ...collected.entries]
			assert.isBelow(page.before, collected.before)
			collected.before = page.before
		}
		const keys = Array.map(collected.entries, entry => {
			if (entry.kind === 'core') return `core:${entry.value.round}`
			return `event:${entry.value.id}`
		})
		assert.strictEqual(keys.length, 390)
		assert.strictEqual(Array.dedupe(keys).length, keys.length)
		assert.isTrue(
			Array.every(
				collected.entries,
				(entry, index) => index === 0 || entry.value.tick >= (collected.entries[index - 1]?.value.tick ?? 0)
			)
		)
		assert.isTrue(Array.every((yield* readFeed(read, [0], 900)).entries, entry => entry.value.tick <= 900))
	})
)
