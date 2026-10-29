import {Array, Number, Option, String} from 'effect'

import type {Point, UnitKind} from '#services/game/schema.ts'
import {tileKey} from '#services/world/lib/utils.ts'
import type {Material} from '#services/world/schema.ts'

// The sim runs 20 ticks a second and sends each client 10 frames a second.
export const TICK_HZ = 20
export const FRAME_HZ = 10

// Each unit's way of moving, speed in tiles a second, cargo it carries, health, body radius for collisions and the research tier it needs.
export const STATS = {
	cart: {cargo: 40, health: 80, mover: 'wheels', radius: 0.36, speed: 1.6, tier: 1},
	digger: {cargo: 20, health: 120, mover: 'tracks', radius: 0.42, speed: 0.7, tier: 1},
	dozer: {cargo: 0, health: 120, mover: 'tracks', radius: 0.4, speed: 0.65, tier: 1},
	loader: {cargo: 10, health: 40, mover: 'fly', radius: 0.2, speed: 2.2, tier: 1},
	rotor: {cargo: 0, health: 50, mover: 'fly', radius: 0.3, speed: 2.6, tier: 4},
	sentry: {cargo: 0, health: 100, mover: 'tracks', radius: 0.36, speed: 0.75, tier: 1},
	skiff: {cargo: 30, health: 70, mover: 'hover', radius: 0.38, speed: 1.4, tier: 3},
	strider: {cargo: 20, health: 90, mover: 'stride', radius: 0.38, speed: 1, tier: 2},
	worker: {cargo: 10, health: 60, mover: 'legs', radius: 0.26, speed: 0.9, tier: 1}
} satisfies Record<
	UnitKind,
	{
		cargo: number
		health: number
		mover: 'fly' | 'hover' | 'legs' | 'stride' | 'tracks' | 'wheels'
		radius: number
		speed: number
		tier: number
	}
>

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
