import {assert, it} from '@effect/vitest'

import {Array, Record} from 'effect'

import {BUILDINGS, GATES, ORE_ITEM, RECIPES, STRUCTURES, START, UNITS} from '#services/game/lib/utils.ts'
import type {Items} from '#services/game/lib/utils.ts'
import {GateId, ItemId} from '#services/game/schema.ts'
import type {BuildingKind} from '#services/game/schema.ts'

// Gates done strictly before `gate`, in milestone order.
function before(gate: GateId) {
	return Array.takeWhile(GateId.literals, each => each !== gate)
}

function itemsOf(items: Items) {
	return Array.filter(ItemId.literals, item => (items[item] ?? 0) > 0)
}

function affords(have: ItemId[], items: Items) {
	return Array.every(itemsOf(items), item => Array.contains(have, item))
}

// Whether a team with `have` can raise a building of `kind` and, if it draws power, a generator to run it.
function usable(open: (tier: GateId) => boolean, have: ItemId[], kind: BuildingKind) {
	const building = BUILDINGS[kind]
	if (!open(building.tier) || !affords(have, building.cost)) return false
	return (
		building.mw <= 0 ||
		Array.some(Record.values(BUILDINGS), other => other.mw < 0 && open(other.tier) && affords(have, other.cost))
	)
}

// Grows `have` by whatever an unlocked recipe makes in a building the team can use, and by water once it can pump, until nothing more is added.
function grow(open: (tier: GateId) => boolean, have: ItemId[]): ItemId[] {
	const made = Array.flatMap(Record.values(RECIPES), recipe => {
		if (!open(recipe.tier) || !usable(open, have, recipe.building) || !affords(have, recipe.inputs)) return []
		return itemsOf(recipe.outputs)
	})
	const next = Array.dedupe([...have, ...Array.filter(['water'] as const, () => usable(open, have, 'pump')), ...made])
	if (next.length === have.length) return have
	return grow(open, next)
}

// Every item a team can make with `done` gates paid: Builders gather wood and every world material by hand.
function makeable(done: GateId[]) {
	return grow(tier => tier === 't0' || Array.contains(done, tier), ['wood', ...Record.values(ORE_ITEM)])
}

// What `name` costs that its own milestone and those before it cannot make.
function lacking(name: string, thing: {cost: Items; tier: GateId}) {
	return Array.map(
		Array.filter(itemsOf(thing.cost), item => !Array.contains(makeable([...before(thing.tier), thing.tier]), item)),
		item => `${name} lacks ${item}`
	)
}

it('lets every milestone be paid from what the milestones before it unlock', () => {
	assert.deepStrictEqual(
		Array.flatMap(GateId.literals, gate => {
			const missing = Array.map(
				Array.filter(itemsOf(GATES[gate].cost), item => !Array.contains(makeable(before(gate)), item)),
				item => `${gate} lacks ${item}`
			)
			if (gate === 't0' || Array.contains(before(gate), GATES[gate].needs)) return missing
			return [`${gate} comes before ${GATES[gate].needs}`, ...missing]
		}),
		[]
	)
})

it('makes every building, structure and unit mark from what its own milestone and those before it unlock', () => {
	assert.deepStrictEqual(
		[
			...Array.flatMap(Record.toEntries(BUILDINGS), entry => lacking(entry[0], entry[1])),
			...Array.flatMap(Record.toEntries(STRUCTURES), entry => lacking(entry[0], entry[1])),
			...Array.flatMap(Record.toEntries(UNITS), entry =>
				Array.flatMap(entry[1].marks, (mark, index) => lacking(`${entry[0]} mark ${index + 1}`, mark))
			)
		],
		[]
	)
})

it('uses every item, and can make what the Signal cycles take', () => {
	const cycle: ItemId[] = ['heavy_frame', 'lumen_cell', 'signal_core']
	const used = Array.dedupe([
		...Array.flatMap(Record.values(RECIPES), recipe => itemsOf(recipe.inputs)),
		...Array.flatMap(Record.values(GATES), gate => itemsOf(gate.cost)),
		...Array.flatMap(Record.values(BUILDINGS), building => [
			...itemsOf(building.cost),
			...itemsOf(building.fuels ?? {})
		]),
		...Array.flatMap(Record.values(STRUCTURES), structure => itemsOf(structure.cost)),
		...Array.flatMap(Record.values(UNITS), unit => Array.flatMap(unit.marks, mark => itemsOf(mark.cost))),
		...cycle
	])
	assert.deepStrictEqual(
		Array.filter(ItemId.literals, item => !Array.contains(used, item)),
		[]
	)
	assert.deepStrictEqual(
		Array.filter(cycle, item => !Array.contains(makeable([...GateId.literals]), item)),
		[]
	)
})

it('starts a team with one Builder and an empty Home, from which hand-gathering makes a Miner and a second unit', () => {
	assert.deepStrictEqual(START, {stock: {}, units: ['builder']})
	assert.deepStrictEqual(
		[...lacking('builder mark 1', UNITS.builder.marks[0]), ...lacking('miner', BUILDINGS.miner_mk1)],
		[]
	)
})
