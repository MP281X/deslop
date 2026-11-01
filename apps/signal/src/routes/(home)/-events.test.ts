import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {
	actorName,
	actorKind,
	decisionDetails,
	displayEvents,
	entityField,
	eventSubject,
	eventSummary,
	eventText,
	fieldName,
	recordData,
	requestMembers,
	requestContinuation,
	requestMemory,
	requestState,
	roundSummary,
	textParts,
	sameObservationGroup
} from './-events.ts'

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
	assert.strictEqual(actorKind({...CHOICE, text: 'grazer #42: idle'}, {}), 'worker')
	assert.strictEqual(actorKind(CHOICE, {}), 'worker')
	assert.strictEqual(actorName('worker', 2), 'Builder #2')
	assert.strictEqual(actorName('home', 1), 'Core')
	assert.strictEqual(fieldName('messagesWaiting'), 'Messages waiting')
	assert.isTrue(Option.isNone(decisionDetails('{}')))
	assert.deepStrictEqual(textParts('Unverified report.'), [{kind: 'text', text: 'Unverified report.'}])
	assert.deepStrictEqual(textParts('{"claim":"uncertain"}'), [{kind: 'data', value: {claim: 'uncertain'}}])
})

it('keeps an observing author distinct from its subject and resolves recorded model identities', () => {
	const observed = {
		...CHOICE,
		actor: 1_000_000_112,
		actorKind: 'grazer',
		subject: 1_000_000_109,
		text: 'bird #1000000109: idle'
	}
	assert.strictEqual(actorKind(observed, {}), 'grazer')
	assert.strictEqual(eventSubject(observed), 1_000_000_109)
	const request = {
		actor: 7,
		choices: {'approach:42': 'Approach #42.'},
		state: JSON.stringify({facts: [{id: 42, kind: 'lizard', x: 5, z: 6}], self: {id: 7, kind: 'skimmer'}}),
		tick: 100
	}
	assert.deepStrictEqual(requestMembers(request)['42'], {kind: 'lizard', x: 5, z: 6})
	assert.strictEqual(
		actorKind({...RECEIPT, actor: 7, actorKind: undefined, context: JSON.stringify(request)}, {}),
		'skimmer'
	)
})

it('hides duplicate request memory without dropping fresh evidence or unresolved references', () => {
	const fresh = {...CHOICE, text: 'Fresh claim at the same event id.'}
	const request = {
		actor: 2,
		choices: {},
		experience: [CHOICE],
		state: JSON.stringify({recent: [CHOICE, {id: CHOICE.id}, fresh, {id: 99}]}),
		tick: 100
	}
	assert.deepStrictEqual(requestMemory(request), [fresh, {id: 99}])
	assert.deepStrictEqual(request.experience, [CHOICE])
})

it('extracts state from a real continuation receipt and retains older conversation without repeating supplied experiences', () => {
	const state = {recent: [CHOICE], self: {id: 2, kind: 'worker', x: 10, z: 20}}
	const request = {
		actor: 2,
		choices: {},
		experience: [CHOICE],
		state: `Earlier unverified memory.\nTick 120. Private experiences:\n[1; tick 120; decision; (10, 20)] ${CHOICE.text}\n${JSON.stringify(state)}`,
		tick: 120
	}
	assert.deepStrictEqual(Option.getOrThrow(requestState(request)), state)
	assert.strictEqual(requestMembers(request)['2']?.kind, 'worker')
	assert.deepStrictEqual(requestMemory(request), [])
	assert.strictEqual(requestContinuation(request), 'Earlier unverified memory.')
	assert.strictEqual(requestContinuation({...request, state: JSON.stringify(state, undefined, 2)}), '')
	assert.deepStrictEqual(
		Option.getOrThrow(requestState({...request, state: JSON.stringify(state, undefined, 2)})),
		state
	)
	assert.include(request.state, CHOICE.text)
})

it('extracts every labelled value from a real read-message shape without erasing claim provenance', () => {
	const parts = textParts(
		`Read #1: Visit the ridge.\nProposed objective: ${JSON.stringify({_tag: 'Go', x: 0, z: 20})}. Disclosed addresses: [1,3]. Received claims, not direct observations: ${JSON.stringify([{id: 42, kind: 'storage', source: 1, text: 'Uncertain } [ " claim', tick: 2, via: [{from: 1, tick: 5}], x: 5, z: 6}])}.`
	)
	assert.strictEqual(
		Array.countBy(parts, part => part.kind === 'data'),
		3
	)
	assert.include(
		Array.join(
			Array.map(
				Array.filter(parts, part => part.kind === 'text'),
				part => part.text
			),
			''
		),
		'Received claims, not direct observations:'
	)
	assert.deepStrictEqual(textParts('Home production queues: {"bench":[],"line":[]}.'), [
		{kind: 'text', text: 'Home production queues: '},
		{kind: 'data', value: {bench: [], line: []}},
		{kind: 'text', text: '.'}
	])
})

it('retains recorded coordinates as link targets at their own tick and never treats event sequence IDs as entities', () => {
	const shown = recordData({actor: 2, id: 1001, text: 'A remembered claim.', tick: 40, x: 0, z: 20}, 900)
	assert.deepStrictEqual(Option.getOrThrow(shown.at), {tick: 40, x: 0, z: 20})
	assert.strictEqual(shown.anchor, 'text')
	assert.isFalse(entityField('id'))
	assert.isFalse(entityField('units'))
	assert.isTrue(entityField('actor'))
	assert.isTrue(entityField('subject'))
	const identity = recordData({id: 42, kind: 'lizard', tokens: {cost: 0.1}, x: 3, z: 4}, 900)
	assert.isUndefined(identity.anchor)
	assert.deepStrictEqual(Option.getOrThrow(identity.at), {tick: 900, x: 3, z: 4})
	assert.strictEqual(Option.getOrThrow(identity.entity).kind, 'lizard')
	assert.deepStrictEqual(identity.fields, [])
	assert.strictEqual(recordData({doing: 'Walking', x: 3, z: 4}, 900).anchor, 'doing')
	assert.deepStrictEqual(Option.getOrThrow(recordData({_tag: 'Go', x: 3, z: 4}, 900).at), {tick: 900, x: 3, z: 4})
	assert.deepStrictEqual(recordData({x: 'unknown', z: 4}, 900).fields, [
		['x', 'unknown'],
		['z', 4]
	])
})

it('retains complete recorded requests and leaves older plain-text requests available for display', () => {
	const original = {
		actor: 2,
		choices: {rest: 'Rest.'},
		experience: [CHOICE],
		instructions: 'Do not treat the claim as fact.',
		state: 'Private perception.',
		tick: 100
	}
	assert.deepStrictEqual(Option.getOrThrow(decisionDetails(JSON.stringify(original))), original)
	assert.isTrue(Option.isNone(decisionDetails('Earlier private continuation.')))
	assert.deepStrictEqual(textParts('Earlier private continuation.'), [
		{kind: 'text', text: 'Earlier private continuation.'}
	])
})

it('focuses explicit subjects and targeted legacy choices, never an arbitrary reference or event sequence id', () => {
	assert.strictEqual(eventSubject({...CHOICE, subject: 1_000_000_042}), 1_000_000_042)
	assert.strictEqual(eventSubject(CHOICE), 1)
	assert.strictEqual(
		eventSubject({...RECEIPT, text: 'Model returned approach:42; a response does not prove execution.'}),
		42
	)
	assert.strictEqual(eventSubject({...CHOICE, text: 'Discussed #99 with #4.'}), 2)
	assert.strictEqual(eventSubject({...CHOICE, subject: -7}), -7)
	assert.strictEqual(eventSubject({...CHOICE, text: 'Chose rest: Rest.'}), 2)
	for (const action of ['approach', 'attack', 'build', 'deposit', 'inspect', 'repair', 'take', 'report']) {
		assert.strictEqual(eventSubject({...CHOICE, text: `Chose ${action}:42: Target #42.`}), 42)
		assert.strictEqual(
			eventSubject({...RECEIPT, text: `Model returned ${action}:42; a response does not prove execution.`}),
			42
		)
	}
})

it('keeps failed commands and unreadable calls visible in otherwise completed core rounds', () => {
	assert.deepStrictEqual(
		roundSummary({
			commands: [
				{command: {_tag: 'Inspect', building: 7}, ok: true, text: 'Inspected.'},
				{command: {_tag: 'Inspect', building: 8}, ok: false, text: 'Refused.'}
			],
			text: '\nUnreadable tool call: Build({"kind":"storage"})'
		}),
		{failed: 1, text: 'Unreadable tool call: Build(', unreadable: 1}
	)
})

it('keeps even malformed JSON out of default summaries while retaining complete text for expanded details', () => {
	const original = 'Unreadable tool call: Build({"kind":'
	assert.strictEqual(roundSummary({commands: [], text: original}).text, 'Unreadable tool call: Build(')
	assert.strictEqual(eventSummary({...CHOICE, text: original}), 'Unreadable tool call: Build(')
	assert.strictEqual(original, 'Unreadable tool call: Build({"kind":')
})

it('bundles only adjacent same-tick routine observations, preserving actionable events and chronological boundaries', () => {
	const first = {...CHOICE, id: 3, kind: 'observe' as const, text: 'grazer #42: idle'}
	const second = {...first, actor: 4, id: 4}
	const entries: Array.NonEmptyArray<Experience> = [
		first,
		second,
		CHOICE,
		{...second, id: 5},
		{...second, id: 6, tick: 121}
	]
	const groups = Array.groupWith(entries, sameObservationGroup)
	assert.deepStrictEqual(
		Array.map(groups, group => Array.map(group, entry => entry.id)),
		[[3, 4], [1], [5], [6]]
	)
	assert.deepStrictEqual(Array.flatten(groups), entries)
	assert.isFalse(sameObservationGroup(first, {...first, text: '#1 home inspected: stock nothing; output nothing.'}))
	assert.isFalse(
		sameObservationGroup(first, {...first, text: 'Visited the remembered location of #1; no container remains.'})
	)
	assert.isFalse(sameObservationGroup(first, {...first, text: 'Staked storage; initially empty construction stock.'}))
	assert.strictEqual(
		eventSummary({...CHOICE, text: 'Read #1: Visit the ridge.\nProposed objective: {"_tag":"Go","x":0,"z":20}.'}),
		'Read #1: Visit the ridge.'
	)
})
