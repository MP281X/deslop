import {assert, it} from '@effect/vitest'

import {Array, HashMap, HashSet, Option} from 'effect'

import {ChapterNumber, keyOf} from './contract.ts'
import type {ReadingChapter} from './contract.ts'
import {stripOf, turnPage, turnsOf, withUnsaved} from './shared.ts'
import type {ReaderState} from './shared.ts'

function item(number: number, pages: number, version = 'a') {
	return {
		number: ChapterNumber.make(number),
		pages: Array.makeBy(pages, page => `https://example.com/${number}/${version}/${page}.png`),
		postedAt: Option.none(),
		reading: Option.none(),
		series: 'manga' as const,
		title: ''
	} satisfies ReadingChapter
}

const OPENED: ReaderState = {finished: HashSet.empty(), inView: Option.none(), strip: []}

function turn(state: ReaderState, following: readonly ReadingChapter[], index: number) {
	return Option.getOrThrow(turnPage(state, {following, index, opened: ChapterNumber.make(240)}))
}

it('keeps the strip a reader opened while its pages are revised or a gap fills before it', () => {
	const first = turn(OPENED, [item(240, 3), item(241, 2), item(242, 2)], 1)
	const revised = [item(240, 3, 'b'), item(240.5, 1), item(241, 2), item(242, 2)]
	assert.deepStrictEqual(stripOf(first.next, revised), [item(240, 3), item(241, 2)])
	// Page 4 of the strip is the second page of 241, as the strip reported it, not a page of 240.5.
	const second = turn(first.next, revised, 4)
	assert.deepStrictEqual(second.saves, [
		{done: true, number: ChapterNumber.make(240), page: 2, series: 'manga'},
		{done: true, number: ChapterNumber.make(241), page: 1, series: 'manga'}
	])
	assert.deepStrictEqual(stripOf(second.next, revised), [item(240, 3), item(241, 2), item(242, 2)])
})

it('shows a place the server has not taken over its own, leaving other chapters as they were', () => {
	const chapters = [item(240, 3), item(241, 2)]
	const shown = withUnsaved(chapters, HashMap.make([keyOf(item(241, 2)), {done: false, page: 1}]))
	assert.strictEqual(shown[0], chapters[0])
	assert.deepStrictEqual(shown[1]?.reading, Option.some({done: false, page: 1}))
	assert.strictEqual(withUnsaved(chapters, HashMap.empty()), chapters)
})

it('pairs only portrait interior pages within each chapter and finds the same page when it folds', () => {
	const first = item(240, 6)
	const second = item(241, 3)
	const wide = HashSet.make('https://example.com/240/a/4.png')
	const chapters = [first, second]
	const spread = turnsOf(chapters, true, wide)
	assert.deepStrictEqual(spread, [[0], [1, 2], [3], [4], [5], [6], [7, 8]])
	assert.deepStrictEqual(Option.getOrThrow(Array.findFirst(spread, pair => Array.contains(pair, 2))), [1, 2])
	assert.deepStrictEqual(
		Option.getOrThrow(Array.findFirst(turnsOf(chapters, false, wide), pair => Array.contains(pair, 2))),
		[2]
	)
})
