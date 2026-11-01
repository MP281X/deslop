import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {actorName, decisionDetails, displayEvents, eventModel, eventText, fieldName, jsonParts} from './-events.ts'

import type {Experience} from '#services/game/schema.ts'

const CHOICE: Experience = {
	actor: 2,
	actorKind: 'worker',
	id: 1,
	kind: 'decision',
	text: 'Chose inspect:1: Open container #1; remembered contents may be stale.',
	tick: 120,
	x: 10,
	z: 20
}
const RECEIPT: Experience = {
	...CHOICE,
	context: '{}',
	id: 2,
	text: 'Model returned inspect:1; a response does not prove execution.',
	tokens: {cost: 0.1}
}

it('presents a choice and its exact response once without discarding usage or changing originals', () => {
	const shown = displayEvents([CHOICE, RECEIPT])
	assert.strictEqual(shown.length, 1)
	assert.strictEqual(shown[0]?.context, '{}')
	assert.deepStrictEqual(shown[0]?.tokens, {cost: 0.1})
	assert.strictEqual(shown[0]?.text, CHOICE.text)
	assert.isUndefined(CHOICE.context)
	assert.strictEqual(RECEIPT.id, 2)
	assert.include(eventText(CHOICE), 'remembered contents may be stale')
	assert.notInclude(eventText(CHOICE), 'inspect:1:')
})

it('keeps failures, multiple responses, other ticks/actors and unmatched receipts distinct', () => {
	for (const receipt of [
		{...RECEIPT, actor: 4},
		{...RECEIPT, tick: 121},
		{...RECEIPT, text: 'Model failed.'}
	]) {
		assert.strictEqual(displayEvents([CHOICE, receipt]).length, 2)
	}
	assert.strictEqual(displayEvents([RECEIPT]).length, 1)
	assert.strictEqual(displayEvents([CHOICE, RECEIPT, {...RECEIPT, id: 3}]).length, 3)
})

it('uses real model identities and parses request records without treating malformed JSON as structured data', () => {
	assert.strictEqual(eventModel({...CHOICE, text: 'grazer #42: idle'}, {grazer: 'portrait'}), 'grazer')
	assert.strictEqual(eventModel(CHOICE, {}), 'worker')
	assert.strictEqual(actorName('worker', 2), 'Builder #2')
	assert.strictEqual(actorName('home', 1), 'Core')
	assert.strictEqual(fieldName('messagesWaiting'), 'Messages waiting')
	assert.isTrue(Option.isNone(decisionDetails('{}')))
	assert.isTrue(Option.isNone(jsonParts('Unverified report.')))
	assert.deepStrictEqual(Option.getOrThrow(jsonParts('{"claim":"uncertain"}')).value, {claim: 'uncertain'})
	assert.deepStrictEqual(Option.getOrThrow(jsonParts('Home production queues: {"bench":[],"line":[]}.')), {
		before: 'Home production queues: ',
		value: {bench: [], line: []}
	})
})
