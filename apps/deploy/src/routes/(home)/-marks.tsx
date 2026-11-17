import {Array, Boolean, Option, String} from 'effect'

import {CubeIcon, TerminalWindowIcon} from '@phosphor-icons/react'

import {AppMark, ThemedMark} from '@deslop/components-web/blocks/marks'
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

// A row's mark: the app's own pixel mark filling the row's square, else a software brand or a glyph at 16px.
export function ApplicationIcon(props: {name: string; process?: string | undefined; container?: boolean}) {
	const brand = Option.getOrUndefined(
		Array.findFirst(brands, candidate => candidate.pattern.test(`${props.name} ${props.process ?? ''}`))
	)
	function mark() {
		if (brand !== undefined) {
			return Boolean.match(brand.light === brand.dark, {
				onFalse: () => <ThemedMark light={brand.light} dark={brand.dark} className="size-4" />,
				onTrue: () => <brand.light aria-hidden className="size-4" />
			})
		}
		if (props.container === true) return <CubeIcon aria-hidden className="text-muted-foreground size-4" />
		return <TerminalWindowIcon aria-hidden className="text-muted-foreground size-4" />
	}
	// An app's own mark, also on what is named after it, such as `stash preview` or `stash-update`.
	return <AppMark name={String.split(props.name, /[ -]/u)[0]} fallback={mark()} />
}
