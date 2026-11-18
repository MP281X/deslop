import {assert, it} from '@effect/vitest'

import {Array, HashMap, HashSet, Option} from 'effect'

import type {ReaderState} from '#lib/reader.ts'
import {stripOf, turnPage, withUnsaved} from '#lib/reader.ts'
import {keyOf} from '#services/chapters/lib/utils.ts'
import {ChapterNumber} from '#services/chapters/schema.ts'
import type {ChapterItem} from '#services/chapters/schema.ts'

function item(number: number, pages: number, version = 'a') {
	return {
		number: ChapterNumber.make(number),
		pages: Array.makeBy(pages, page => `https://example.com/${number}/${version}/${page}.png`),
		postedAt: Option.none(),
		reading: Option.none(),
		series: 'manga' as const,
		title: ''
	} satisfies ChapterItem
}

const OPENED: ReaderState = {finished: HashSet.empty(), inView: Option.none(), strip: []}

function turn(state: ReaderState, following: readonly ChapterItem[], index: number) {
	return Option.getOrThrow(turnPage(state, {following, index, opened: ChapterNumber.make(240)}))
}

it('keeps the strip a reader opened while its pages are revised or a gap fills before it', () => {
	const first = turn(OPENED, [item(240, 3), item(241, 2), item(242, 2)], 1)
	const revised = [item(240, 3, 'b'), item(240.5, 1), item(241, 2), item(242, 2)]
	assert.deepStrictEqual(stripOf(first.next, revised), [item(240, 3), item(241, 2)])
	// Page 4 of the strip is the second page of 241, as the native strip reported it, not a page of 240.5.
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
