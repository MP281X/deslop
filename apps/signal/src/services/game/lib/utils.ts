import {Array, Number, Option, String} from 'effect'

import type {EnemyKind, MobKind, Point, UnitKind} from '#services/game/schema.ts'
import {tileKey} from '#services/world/lib/utils.ts'
import type {Material} from '#services/world/schema.ts'

// The sim runs 20 ticks a second and sends each client 10 frames a second.
export const TICK_HZ = 20
export const FRAME_HZ = 10

// Each unit's way of moving, speed in tiles a second, cargo it carries, health, body radius for collisions, how far it sees in tiles and the research tier it needs.
export const STATS = {
	cart: {cargo: 40, health: 80, mover: 'wheels', radius: 0.36, sight: 7, speed: 1.6, tier: 1},
	digger: {cargo: 20, health: 120, mover: 'tracks', radius: 0.42, sight: 6, speed: 0.7, tier: 1},
	dozer: {cargo: 0, health: 120, mover: 'tracks', radius: 0.4, sight: 6, speed: 0.65, tier: 1},
	loader: {cargo: 10, health: 40, mover: 'fly', radius: 0.2, sight: 8, speed: 2.2, tier: 1},
	rotor: {cargo: 0, health: 50, mover: 'fly', radius: 0.3, sight: 14, speed: 2.6, tier: 4},
	sentry: {cargo: 0, health: 100, mover: 'tracks', radius: 0.36, sight: 10, speed: 0.75, tier: 1},
	skiff: {cargo: 30, health: 70, mover: 'hover', radius: 0.38, sight: 8, speed: 1.4, tier: 3},
	strider: {cargo: 20, health: 90, mover: 'stride', radius: 0.38, sight: 9, speed: 1, tier: 2},
	worker: {cargo: 10, health: 60, mover: 'legs', radius: 0.26, sight: 7, speed: 0.9, tier: 1}
} satisfies Record<
	UnitKind,
	{
		cargo: number
		health: number
		mover: 'fly' | 'hover' | 'legs' | 'stride' | 'tracks' | 'wheels'
		radius: number
		sight: number
		speed: number
		tier: number
	}
>

// How far Home sees, in tiles.
export const HOME_SIGHT = 14

// The hostile each biome sends, in Biome order.
export const ENEMIES = [
	'scrapdog',
	'skimmer',
	'burrower',
	'golem',
	'crawler',
	'ruinsentry',
	'drifter',
	'lurker',
	'skimmer',
	'skimmer',
	'golem',
	'glitch',
	'lurker',
	'burrower',
	'golem',
	'golem',
	'scrapdog'
] satisfies EnemyKind[]

// How each creature lives: walkers wander and bolt, fliers take off and land elsewhere, swarms and fish stay at their spot; speeds in tiles a second, the name its card shows and what it does when left alone.
export const CREATURES = {
	beetles: {flee: 0, life: 'swarm', name: 'Heat beetles', rest: 'basking at a vent', walk: 0},
	bird: {flee: 1.5, life: 'flier', name: 'Bird drone', rest: 'pecking at the ground', walk: 0},
	fireflies: {flee: 0, life: 'swarm', name: 'Fireflies', rest: 'blinking over the grass', walk: 0},
	fish: {flee: 0, life: 'fish', name: 'Leaping fish', rest: 'schooling under the surface', walk: 0},
	grazer: {flee: 1.7, life: 'walker', name: 'Grazer', rest: 'grazing', walk: 0.48},
	hare: {flee: 1.35, life: 'walker', name: 'Snow hare', rest: 'sitting still, ears up', walk: 0.34},
	heron: {flee: 1.1, life: 'flier', name: 'Heron', rest: 'stalking the shallows', walk: 0},
	jellies: {flee: 0, life: 'swarm', name: 'Glow jellies', rest: 'drifting and pulsing', walk: 0},
	lizard: {flee: 1.8, life: 'walker', name: 'Rock lizard', rest: 'basking, doing push-ups', walk: 1.2},
	moths: {flee: 0, life: 'swarm', name: 'Ruin moths', rest: 'circling an old lamp', walk: 0},
	yak: {flee: 0.8, life: 'walker', name: 'Frost yak', rest: 'standing in the snow', walk: 0.27}
} satisfies Record<
	MobKind,
	{flee: number; life: 'fish' | 'flier' | 'swarm' | 'walker'; name: string; rest: string; walk: number}
>

// The wildlife of each biome, in Biome order: per 16-tile patch of land, the chance of a group and how many in it.
export const WILDLIFE: {chance: number; kind: MobKind; most: number}[][] = [
	[
		{chance: 0.3, kind: 'grazer', most: 4},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.25, kind: 'heron', most: 1},
		{chance: 0.25, kind: 'fireflies', most: 1},
		{chance: 0.25, kind: 'fish', most: 1}
	],
	[{chance: 0.35, kind: 'lizard', most: 2}],
	[
		{chance: 0.3, kind: 'yak', most: 3},
		{chance: 0.25, kind: 'hare', most: 2}
	],
	[{chance: 0.35, kind: 'beetles', most: 1}],
	[
		{chance: 0.3, kind: 'moths', most: 1},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[{chance: 0.35, kind: 'jellies', most: 1}],
	[
		{chance: 0.25, kind: 'bird', most: 1},
		{chance: 0.25, kind: 'lizard', most: 1}
	],
	[{chance: 0.3, kind: 'lizard', most: 2}],
	[{chance: 0.35, kind: 'lizard', most: 2}],
	[
		{chance: 0.25, kind: 'heron', most: 1},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.3, kind: 'heron', most: 1},
		{chance: 0.25, kind: 'fireflies', most: 1},
		{chance: 0.2, kind: 'fish', most: 1}
	],
	[
		{chance: 0.4, kind: 'fish', most: 1},
		{chance: 0.2, kind: 'heron', most: 1}
	],
	[
		{chance: 0.3, kind: 'lizard', most: 2},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.3, kind: 'jellies', most: 1},
		{chance: 0.25, kind: 'hare', most: 2}
	],
	[
		{chance: 0.3, kind: 'yak', most: 3},
		{chance: 0.3, kind: 'hare', most: 2}
	],
	[
		{chance: 0.3, kind: 'grazer', most: 3},
		{chance: 0.25, kind: 'bird', most: 1},
		{chance: 0.2, kind: 'hare', most: 1}
	]
]

// What each unit costs off Home's line.
export const COSTS = {
	cart: {iron: 20, stone: 10},
	digger: {copper: 10, iron: 30},
	dozer: {iron: 30, stone: 20},
	loader: {copper: 15, iron: 10},
	rotor: {copper: 20, crystal: 10},
	sentry: {copper: 15, iron: 25},
	skiff: {copper: 20, lithium: 10},
	strider: {bauxite: 20, iron: 30},
	worker: {copper: 5, iron: 10}
} satisfies Record<UnitKind, Partial<Record<Material, number>>>

// The lab's tiers in order: each costs materials and unlocks a unit that crosses ground the last could not.
export const RESEARCH = [
	{cost: {bauxite: 60, copper: 40}, name: 'aluminium frames (striders)', seconds: 60},
	{cost: {copper: 40, lithium: 40}, name: 'lithium cells (skiffs)', seconds: 90},
	{cost: {crystal: 30, iron: 60}, name: 'crystal optics (rotors)', seconds: 120}
] satisfies {cost: Partial<Record<Material, number>>; name: string; seconds: number}[]

export function nameOf(kind: string, number: number) {
	return `${String.capitalize(kind)} ${number}`
}

// How far and which way a place lies from another, as the player reads it: "20 tiles NE".
export function bearing(from: Point, to: Point) {
	// Degrees clockwise from north (−z), in eight sectors.
	const sector = Number.round((((Math.atan2(to.x - from.x, from.z - to.z) * 180) / Math.PI + 360) % 360) / 45, 0) % 8
	return `${Number.round(Math.hypot(to.x - from.x, to.z - from.z), 0)} tiles ${Option.getOrElse(Array.get(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], sector), () => 'N')}`
}

// Where Home, the lab and the sentry pad stand round the spawn tile; units drive round them.
export function buildings(spawn: {x: number; z: number}) {
	return {
		home: {x: spawn.x + 0.5, z: spawn.z + 0.5},
		lab: {x: spawn.x + 5.5, z: spawn.z - 1},
		pad: {x: spawn.x - 4.5, z: spawn.z + 3.5}
	}
}

// The tiles the buildings stand on.
export function staticTiles(spawn: {x: number; z: number}) {
	return [
		...Array.flatMap(Array.range(-1, 1), dz =>
			Array.map(Array.range(-1, 1), dx => tileKey(spawn.x + dx, spawn.z + dz))
		),
		...Array.flatMap(Array.range(-2, -1), dz => Array.map(Array.range(5, 6), dx => tileKey(spawn.x + dx, spawn.z + dz)))
	]
}
