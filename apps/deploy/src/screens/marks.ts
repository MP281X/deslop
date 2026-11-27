import {Array, Function, Option, Order, Number, String, pipe} from 'effect'

import {workloadName} from '#contracts'
import type {InventoryItem, Process} from '#contracts'

import {artwork} from '#screens/artwork.gen.ts'

const appMarks: Readonly<Record<string, string>> = {
	auth: artwork.auth,
	deploy: artwork.deploy,
	gateway: artwork.gateway,
	opm: artwork.opm,
	portfolio: artwork.portfolio,
	scope: artwork.scope,
	stash: artwork.stash,
	trips: artwork.trips
}
const brands = [
	{pattern: /\bt3code\b/u, source: artwork.t3Light},
	{pattern: /\b(?:node|nodejs)(?:-MainThread)?\b/iu, source: artwork.nodejs},
	{pattern: /\bbun(?:\.native)?\b/u, source: artwork.bun},
	{pattern: /\b(?:postgres|postgresql|postmaster)\b/u, source: artwork.postgresql},
	{pattern: /\bredis(?:-server)?\b/u, source: artwork.redis},
	{pattern: /\b(?:docker|dockerd|containerd)\b/u, source: artwork.docker},
	{pattern: /\b(?:vp|vite)\b/u, source: artwork.vite},
	{pattern: /\bturbo\b/u, source: artwork.turborepoIconDark},
	{pattern: /\besbuild\b/u, source: artwork.esbuild},
	{pattern: /\bcloudflared\b/u, source: artwork.cloudflare}
]

export function artworkOf(item: InventoryItem) {
	const name = workloadName(item)

	const app = appMarks[Array.headNonEmpty(String.split(name, /[ -]/u))]
	if (app !== undefined) return {pixel: true, source: app}
	const process = pipe(
		item.processes,
		Option.getOrElse(Array.empty<Process>),
		Array.match({
			onEmpty: Function.constant(''),
			onNonEmpty: entries =>
				Array.max(
					entries,
					Order.mapInput(Number.Order, (entry: Process) => entry.memory)
				).name
		})
	)
	return {
		pixel: false,
		source: pipe(
			brands,
			Array.findFirst(candidate => candidate.pattern.test(`${name} ${process}`)),
			Option.map(entry => entry.source),
			Option.getOrUndefined
		)
	}
}
