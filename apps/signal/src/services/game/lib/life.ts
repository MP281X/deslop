import {
	Array,
	Boolean,
	MutableHashMap,
	MutableList,
	Number,
	Option,
	Order,
	Record,
	Schema,
	String,
	Struct
} from 'effect'
import type {Types} from 'effect'

import {TICK_HZ} from '#services/game/lib/utils.ts'
import {UnitKind} from '#services/game/schema.ts'
import type {Experience, Fact, Individual, Life, LocalDecision, Point, Standing} from '#services/game/schema.ts'

const TRACKS: Record<string, NonNullable<Life['traces'][number]['impressions']>[number]['kind']> = {
	cart: 'wheels',
	digger: 'treads',
	dozer: 'treads',
	sentry: 'treads'
}
const DAY = 24 * 60 * TICK_HZ
const TRAIL_LIFE = 6 * 60 * TICK_HZ

type Person = Types.Mutable<Individual>

export function daylightAt(tick: number) {
	return Number.clamp(0.5 + Math.cos((tick / DAY) * Math.PI * 2) * 0.7, {maximum: 1, minimum: 0.12})
}

export type Body = Point & {
	id: number
	kind: string
	team?: number
	health: number
	yaw: number
	doing: string
	act: string
	cargo?: number
	capacity?: number
	class?: string
	objective?: Standing
}

// Private experience and shared physical traces have different owners; only explicit reports cross that boundary.
export function makeLife(saved?: Life, unarchived: readonly Experience[] = []) {
	const people = MutableHashMap.fromIterable<number, Person>(
		Array.map(saved?.individuals ?? [], individual => [individual.id, {...individual}] as const)
	)
	const cores = MutableHashMap.fromIterable<number, Types.Mutable<Life['cores'][number]>>(
		Array.map(saved?.cores ?? [], entry => [entry.team, {...entry}] as const)
	)
	const traces = MutableHashMap.fromIterable<string, Types.Mutable<Life['traces'][number]>>(
		Array.map(saved?.traces ?? [], trace => [`${trace.x},${trace.z}`, {...trace}] as const)
	)
	const pending = MutableList.make<Experience>()
	MutableList.appendAll(pending, unarchived)
	const state = {pollution: Array.some(saved?.traces ?? [], trace => trace.smog > 0), sequence: saved?.sequence ?? 0}
	const air = MutableHashMap.empty<string, number>()

	function core(team: number) {
		return Option.getOrElse(MutableHashMap.get(cores, team), () => {
			const created = {contacts: Array.empty<number>(), facts: Array.empty<Fact>(), team}
			MutableHashMap.set(cores, team, created)
			return created
		})
	}

	function person(id: number, tick: number) {
		return Option.getOrElse(MutableHashMap.get(people, id), () => {
			const created: Person = {
				born: tick,
				contacts: [],
				facts: [],
				guidance: '',
				health: 1,
				id,
				inbox: [],
				intent: 'continue',
				next: tick,
				recent: []
			}
			MutableHashMap.set(people, id, created)
			return created
		})
	}

	function event(
		body: Body,
		tick: number,
		kind: Experience['kind'],
		text: string,
		subject?: number,
		detail?: Pick<Experience, 'context' | 'tokens'>
	) {
		state.sequence += 1
		const entry: Experience = {
			actor: body.id,
			actorKind: body.kind,
			id: state.sequence,
			kind,
			text,
			tick,
			x: body.x,
			z: body.z,
			...detail,
			...Option.match(Option.fromUndefinedOr(subject), {onNone: () => ({}), onSome: found => ({subject: found})})
		}
		const own = person(body.id, tick)
		if (detail?.context === undefined) {
			const experience = Struct.omit(entry, ['actorKind', 'context', 'tokens'])
			own.recent = Array.takeRight([...own.recent, experience], 16)
			own.unrecorded = [...(own.unrecorded ?? []), experience]
		}
		MutableList.append(pending, entry)
		return entry
	}

	function learn(id: number, tick: number, fact: Fact) {
		const own = person(id, tick)
		own.facts = [...Array.filter(own.facts, known => known.id !== fact.id), fact]
	}

	function observe(body: Body, nearby: Body[], tick: number, sight: number) {
		const own = person(body.id, tick)
		if (body.health <= 0 || own.health <= 0) return
		for (const other of Array.filter(
			nearby,
			found => found.id !== body.id && Math.hypot(body.x - found.x, body.z - found.z) <= sight
		)) {
			const before = Array.findFirst(own.facts, fact => fact.id === other.id)
			const text = `${other.kind} #${other.id}: ${other.act}${Boolean.match(other.health <= 0, {onFalse: () => '', onTrue: () => '; a body lies here'})}`
			if (Option.isNone(before) || Option.exists(before, fact => fact.text !== text && other.health <= 0)) {
				event(body, tick, 'observe', text, other.id)
				own.next = Number.min(own.next, tick)
			}
			learn(body.id, tick, {id: other.id, kind: other.kind, source: body.id, text, tick, x: other.x, z: other.z})
			if (
				body.team !== undefined &&
				other.team !== undefined &&
				body.team !== other.team &&
				!Array.contains(own.contacts, other.team)
			) {
				own.contacts = [...own.contacts, other.team]
				event(
					body,
					tick,
					'observe',
					`Direct encounter: communication address ${other.team} is now available.`,
					other.id
				)
			}
		}
	}

	function inspect(body: Body, target: Omit<Fact, 'tick' | 'source'>, tick: number) {
		const previous = Array.findFirst(person(body.id, tick).facts, fact => fact.id === target.id)
		learn(body.id, tick, {...Struct.omit(target, ['via']), source: body.id, tick})
		if (!Option.exists(previous, fact => fact.text === target.text && fact.stage === target.stage)) {
			event(body, tick, 'observe', target.text, target.id)
		}
	}

	function report(body: Body, tick: number, summary: string, facts: Fact[] = [], ids: number[] = []) {
		if (body.team === undefined) return
		const recipient = core(body.team)
		for (const fact of Array.filter(
			facts,
			incoming =>
				!Array.some(recipient.facts, remembered => remembered.id === incoming.id && remembered.tick > incoming.tick)
		)) {
			recipient.facts = [
				...Array.filter(recipient.facts, known => known.id !== fact.id),
				{...fact, via: [...(fact.via ?? []), {from: body.id, tick}]}
			]
		}
		recipient.contacts = Array.dedupe([...recipient.contacts, ...ids])
		return event(body, tick, 'report', summary)
	}

	function send(
		body: Body,
		from: number,
		tick: number,
		text: string,
		order?: Standing,
		ids: readonly number[] = [],
		facts: readonly Fact[] = []
	) {
		const own = person(body.id, tick)
		own.inbox = [
			...own.inbox,
			{
				facts: Array.map(facts, fact => ({...fact, via: [...(fact.via ?? []), {from, tick}]})),
				from,
				ids,
				text,
				...Option.match(Option.fromUndefinedOr(order), {onNone: () => ({}), onSome: objective => ({order: objective})})
			}
		]
		own.next = Number.min(own.next, tick - TICK_HZ * 120)
		event(body, tick, 'message', `A message from #${from} was delivered; not yet read.`)
	}

	function read(body: Body, tick: number) {
		const own = person(body.id, tick)
		const message = Option.getOrUndefined(Array.head(own.inbox))
		if (message !== undefined) {
			own.inbox = Array.drop(own.inbox, 1)
			own.guidance = message.text
			if (message.order !== undefined) own.pending = message.order
			own.contacts = Array.dedupe([...own.contacts, ...message.ids])
			for (const fact of message.facts ?? []) {
				if (!Array.some(own.facts, known => known.id === fact.id && known.tick >= fact.tick)) learn(body.id, tick, fact)
			}
			event(
				body,
				tick,
				'action',
				`Read #${message.from}: ${message.text}\nProposed objective: ${JSON.stringify(message.order)}. Disclosed addresses: ${JSON.stringify(message.ids)}. Received claims, not direct observations: ${JSON.stringify(message.facts ?? [])}.`
			)
		}
	}

	function stamp(body: Body, tick: number) {
		if (body.health <= 0) return
		if (
			Array.contains(
				['bird', 'heron', 'fireflies', 'moths', 'jellies', 'fish', 'skimmer', 'drifter', 'rotor', 'loader', 'skiff'],
				body.kind
			)
		) {
			return
		}
		const x = Math.floor(body.x)
		const z = Math.floor(body.z)
		const key = `${x},${z}`
		const before = Option.getOrUndefined(MutableHashMap.get(traces, key))
		const kind = Option.getOrElse(Record.get(TRACKS, body.kind), () => 'feet' as const)
		MutableHashMap.set(traces, key, {
			impressions: [
				...Array.filter(before?.impressions ?? [], prior => prior.kind !== kind),
				{
					kind,
					tick,
					wear: Number.min(
						1,
						0.015 +
							Option.getOrElse(
								Option.map(
									Array.findFirst(before?.impressions ?? [], prior => prior.kind === kind),
									prior => prior.wear
								),
								() => 0
							)
					)
				}
			],
			smog: before?.smog ?? 0,
			tick,
			wear: Number.min(1, (before?.wear ?? 0) + 0.015),
			x,
			yaw: body.yaw,
			z
		})
	}

	function smogAt(at: Point) {
		if (!state.pollution) return 0
		const key = `${Math.floor(at.x)},${Math.floor(at.z)}`
		return Option.getOrElse(MutableHashMap.get(air, key), () => {
			const amount = Number.sumAll(
				Array.flatMap(Array.range(-8, 8), dz =>
					Array.map(Array.range(-8, 8), dx =>
						Option.getOrElse(
							Option.map(
								MutableHashMap.get(traces, `${Math.floor(at.x) + dx},${Math.floor(at.z) + dz}`),
								trace => trace.smog
							),
							() => 0
						)
					)
				)
			)
			MutableHashMap.set(air, key, amount)
			return amount
		})
	}

	function local(body: Body, tick: number, connected: boolean) {
		const own = person(body.id, tick)
		const relevant = Array.take(
			Array.sortWith(own.facts, fact => Math.hypot(body.x - fact.x, body.z - fact.z), Order.Number),
			12
		)
		const choices: Record<string, string> = {
			continue: 'Continue the current task.',
			east: 'Explore unfamiliar ground to the east.',
			flee: 'Move away from the most recent nearby disturbance.',
			investigate: 'Examine nearby physical traces.',
			north: 'Explore unfamiliar ground to the north.',
			rest: 'Rest and observe.',
			south: 'Explore unfamiliar ground to the south.',
			west: 'Explore unfamiliar ground to the west.'
		}
		if (body.team !== undefined) choices['work'] = 'Resume your own known construction and logistics work.'
		if (body.team !== undefined && own.intent === 'rest') {
			choices['resume'] = 'Resume your accepted standing objective after resting.'
		}
		Array.forEach(relevant, fact => {
			choices[`approach:${fact.id}`] = `Approach remembered #${fact.id} (${fact.kind}), seen at tick ${fact.tick}.`
			if (
				body.class === 'builder' &&
				Schema.is(UnitKind)(fact.kind) &&
				String.includes('a body lies here')(fact.text)
			) {
				choices[`repair:${fact.id}`] =
					`Visit last observed unit #${fact.id} and attempt a physical repair if it is still down.`
			}
			if (
				fact.kind !== 'storage' &&
				fact.kind !== 'resource' &&
				fact.tick >= tick - TICK_HZ * 10 &&
				!String.includes('a body lies here')(fact.text)
			) {
				choices[`attack:${fact.id}`] = `Attack #${fact.id} if still visible. No alliance or ownership immunity exists.`
			}
			if (connected && body.team !== undefined) {
				choices[`report:${fact.id}`] = `Report only this observation about #${fact.id}, preserving its source and age.`
			}
		})
		Array.forEach(
			Array.filter(relevant, fact => fact.kind === 'storage' && fact.stage !== 'Missing'),
			fact => {
				if (body.team === undefined) return
				if (body.class === 'builder' && fact.stage !== undefined && fact.stage !== 'Complete') {
					choices[`build:${fact.id}`] =
						`Choose to help construct remembered site #${fact.id}. Its condition and supplies may have changed.`
				}
				choices[`inspect:${fact.id}`] = `Open container #${fact.id}; remembered contents may be stale.`
				if ((body.cargo ?? 0) > 0) {
					choices[`deposit:${fact.id}`] = `Carry your cargo to #${fact.id} and deposit accessible items, then hold.`
				}
				if ((body.capacity ?? 0) > (body.cargo ?? 0)) {
					choices[`take:${fact.id}`] =
						`Visit container #${fact.id} and take accessible items. Ownership does not protect contents; do not notify its owner.`
				}
			}
		)

		if (Array.isReadonlyArrayNonEmpty(own.inbox)) choices['read'] = 'Read delivered messages. Reading is not obedience.'
		if (own.pending !== undefined) {
			choices['accept'] = `Accept the previously read objective: ${JSON.stringify(own.pending)}.`
		}
		if (connected && body.team !== undefined) {
			choices['survey'] =
				'Send your known resource observations and reports to the Core, preserving their provenance and age, without sending other private experiences.'
			choices['report'] =
				'Report a short activity summary and your learned communication addresses, without sharing every private observation.'
			if (Array.isReadonlyArrayNonEmpty(own.contacts)) {
				choices['addresses'] = 'Report the communication addresses you have learned.'
			}
		}
		return {
			actor: body.id,
			choices,
			experience: Array.take(own.unrecorded ?? own.recent, 24),
			state: JSON.stringify({
				connected,
				daylight: daylightAt(tick),
				environment: {
					activity: Boolean.match(Array.contains(['moths', 'fireflies', 'lurker'], body.kind), {
						onFalse: () =>
							'Choose movement, rest and encounters from local conditions, not an automatic aggression rule.',
						onTrue: () => 'Naturally active at night; rest or shelter during bright daylight.'
					}),
					smog: smogAt(body)
				},
				facts: relevant,
				guidance: own.guidance,
				messagesWaiting: own.inbox.length,
				recent: Array.takeRight(own.recent, 8),
				self: {
					capacity: body.capacity,
					cargo: body.cargo,
					class: body.class,
					doing: body.doing,
					health: body.health,
					id: body.id,
					kind: body.kind,
					objective: body.objective,
					x: body.x,
					z: body.z
				}
			}),
			tick
		} satisfies LocalDecision
	}

	return {
		acknowledge(through: number) {
			for (const entry of MutableList.toArray(pending)) {
				if (entry.id <= through) MutableList.take(pending)
			}
		},
		core,
		drain() {
			return MutableList.toArray(pending)
		},
		environment: (tick: number) => ({day: Math.floor(tick / DAY) + 1, daylight: daylightAt(tick)}),
		event,
		inspect,
		local,
		observe,
		person,
		pollute(at: Point, amount: number, tick: number) {
			if (amount <= 0) return
			state.pollution = true
			MutableHashMap.clear(air)
			for (const dz of Array.range(-3, 3)) {
				for (const dx of Array.range(-3, 3)) {
					const x = Math.floor(at.x) + dx
					const z = Math.floor(at.z) + dz
					const key = `${x},${z}`
					const before = Option.getOrElse(MutableHashMap.get(traces, key), () => ({
						smog: 0,
						tick,
						wear: 0,
						x,
						yaw: 0,
						z
					}))
					MutableHashMap.set(traces, key, {
						...before,
						smog: Number.min(1, before.smog + amount / (1 + dx * dx + dz * dz))
					})
				}
			}
		},
		read,
		report,
		send,
		snapshot() {
			return {
				cores: Array.map(Array.fromIterable(MutableHashMap.values(cores)), own => ({...own})),
				individuals: Array.map(Array.fromIterable(MutableHashMap.values(people)), own => ({...own})),
				sequence: state.sequence,
				traces: Array.map(Array.fromIterable(MutableHashMap.values(traces)), trace => ({...trace}))
			} satisfies Life
		},
		stamp,
		traces(tick: number) {
			return Array.map(Array.fromIterable(MutableHashMap.values(traces)), trace => ({
				...trace,
				fresh: Boolean.match(trace.wear > 0, {
					onFalse: () => 0,
					onTrue: () => Number.max(0, 1 - (tick - trace.tick) / TRAIL_LIFE)
				})
			}))
		},
		visibility: (at: Point, tick: number) => daylightAt(tick) / (1 + smogAt(at) * 0.08),
		weather(tick: number) {
			MutableHashMap.clear(air)
			for (const entry of traces) {
				const trace = entry[1]
				trace.impressions = Array.filter(
					Array.map(trace.impressions ?? [], impression => ({...impression, wear: impression.wear * 0.9995})),
					impression => tick - impression.tick <= TRAIL_LIFE || impression.wear >= 0.001
				)
				trace.wear *= 0.9995
				trace.smog *= 0.99
				if (tick - trace.tick > TRAIL_LIFE && trace.wear < 0.001 && trace.smog < 0.001) {
					MutableHashMap.remove(traces, entry[0])
				}
			}
		}
	}
}
