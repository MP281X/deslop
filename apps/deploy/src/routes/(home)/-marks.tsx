import {Array, Boolean, Option, Record, String} from 'effect'

import {Box, SquareTerminal} from 'lucide-react'

import {Bun} from '@deslop/components-web/ui/svgs/bun'
import {Cloudflare} from '@deslop/components-web/ui/svgs/cloudflare'
import {Docker} from '@deslop/components-web/ui/svgs/docker'
import {Esbuild} from '@deslop/components-web/ui/svgs/esbuild'
import {Nodejs} from '@deslop/components-web/ui/svgs/nodejs'
import {Postgresql} from '@deslop/components-web/ui/svgs/postgresql'
import {Redis} from '@deslop/components-web/ui/svgs/redis'
import {T3Dark} from '@deslop/components-web/ui/svgs/t3Dark'
import {T3Light} from '@deslop/components-web/ui/svgs/t3Light'
import {TurborepoIconDark} from '@deslop/components-web/ui/svgs/turborepoIconDark'
import {TurborepoIconLight} from '@deslop/components-web/ui/svgs/turborepoIconLight'
import {Vite} from '@deslop/components-web/ui/svgs/vite'

import icon from '#routes/icon.svg'

// Every app's mark by its folder; Vite names Deploy's own as a path inside this app, so it joins by name.
const apps: Record<string, string> = {
	...Record.fromEntries(
		Array.map(
			Record.toEntries(
				import.meta.glob<string>('../../../../*/src/routes/icon.svg', {eager: true, import: 'default', query: '?url'})
			),
			entry => [String.split(entry[0], '/')[4] ?? '', entry[1]]
		)
	),
	deploy: icon
}
const brands = [
	{dark: T3Light, light: T3Dark, pattern: /\bt3code\b/u},
	{dark: Nodejs, light: Nodejs, pattern: /\b(?:node|nodejs)(?:-MainThread)?\b/iu},
	{dark: Bun, light: Bun, pattern: /\bbun(?:\.native)?\b/u},
	{dark: Postgresql, light: Postgresql, pattern: /\b(?:postgres|postgresql|postmaster)\b/u},
	{dark: Redis, light: Redis, pattern: /\bredis(?:-server)?\b/u},
	{dark: Docker, light: Docker, pattern: /\b(?:docker|dockerd|containerd)\b/u},
	{dark: Vite, light: Vite, pattern: /\b(?:vp|vite)\b/u},
	{dark: TurborepoIconDark, light: TurborepoIconLight, pattern: /\bturbo\b/u},
	{dark: Esbuild, light: Esbuild, pattern: /\besbuild\b/u},
	{dark: Cloudflare, light: Cloudflare, pattern: /\bcloudflared\b/u}
]

export function ApplicationIcon(props: {name: string; process?: string; container?: boolean; small?: boolean}) {
	// An app's own mark, also on what is named after it, such as `stash preview` or `stash-update`.
	const own = apps[String.split(props.name, /[ -]/u)[0] ?? '']
	const brand = Option.getOrUndefined(
		Array.findFirst(brands, candidate => candidate.pattern.test(`${props.name} ${props.process ?? ''}`))
	)
	function mark() {
		if (own !== undefined) return <img src={own} alt="" className="pixelated size-full object-contain" />
		if (brand !== undefined) {
			if (brand.light === brand.dark) return <brand.light className="size-full" />
			return (
				<>
					<brand.light className="size-full dark:hidden" />
					<brand.dark className="hidden size-full dark:block" />
				</>
			)
		}
		if (props.container === true) return <Box className="size-full" />
		return <SquareTerminal className="size-full" />
	}
	return (
		<span
			className={`text-muted-foreground inline-flex shrink-0 items-center justify-center ${Boolean.match(props.small === true, {onFalse: () => 'size-5', onTrue: () => 'size-4'})}`}
			aria-hidden="true"
		>
			{mark()}
		</span>
	)
}
