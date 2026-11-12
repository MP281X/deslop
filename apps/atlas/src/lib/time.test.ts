import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option} from 'effect'

import {spanOf, stripsOf, ticksOf} from '#lib/time.ts'
import {PullRequest} from '#services/changes/schema.ts'

function prOf(number: number, createdAt: string, mergedAt?: string) {
	return PullRequest.make({
		additions: 0,
		author: 'dev',
		base: 'main',
		checks: 'none',
		comments: 0,
		createdAt,
		deletions: 0,
		files: [],
		head: 'feature',
		...Option.match(Option.fromUndefinedOr(mergedAt), {onNone: () => ({}), onSome: value => ({mergedAt: value})}),
		number,
		repoId: 'github.com/MP281X/deslop',
		review: 'none',
		state: 'open',
		title: 'Change',
		updatedAt: createdAt,
		url: `https://github.com/MP281X/deslop/pull/${number}`
	})
}

function millisOf(iso: string) {
	return DateTime.toEpochMillis(DateTime.makeUnsafe(iso))
}

it('ends an open strip at now and a merged strip at its merge', () => {
	const now = millisOf('2026-11-12T00:00:00Z')
	const strips = stripsOf(
		[prOf(1, '2026-11-10T00:00:00Z'), prOf(2, '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')],
		now
	)
	assert.deepStrictEqual(
		Array.map(strips, strip => [strip.pr.number, strip.start, strip.end]),
		[
			[2, millisOf('2026-11-01T00:00:00Z'), millisOf('2026-11-02T00:00:00Z')],
			[1, millisOf('2026-11-10T00:00:00Z'), now]
		]
	)
})

it('spans the strips and now, at least an hour wide', () => {
	const start = millisOf('2026-11-11T10:00:00Z')
	const now = millisOf('2026-11-11T10:25:00Z')
	const span = spanOf(stripsOf([prOf(1, '2026-11-11T10:00:00Z'), prOf(2, '2026-11-11T10:20:00Z')], now), now)
	assert.strictEqual(span.start, start)
	assert.strictEqual(span.end, start + 3_600_000)
})

it('spaces ticks evenly from start to end', () => {
	assert.deepStrictEqual(ticksOf(0, 100, 5), [0, 25, 50, 75, 100])
})
