import {Array, Boolean, Function, Option, String} from 'effect'

import {CubeIcon, TerminalWindowIcon} from '@phosphor-icons/react'

import {AppMark, ThemedMark} from '@deslop/components-web/marks'
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

export function ApplicationIcon(props: {name: string; process?: string; container?: boolean; small?: boolean}) {
	const brand = Option.getOrUndefined(
		Array.findFirst(brands, candidate => candidate.pattern.test(`${props.name} ${props.process ?? ''}`))
	)
	function mark() {
		if (brand !== undefined) {
			// A brand's artwork fills its viewBox, so a 16px box would read heavier than the pixel marks' inset artwork.
			return (
				<span className="flex size-3 items-center justify-center">
					{Boolean.match(brand.light === brand.dark, {
						onFalse: () => <ThemedMark light={brand.light} dark={brand.dark} className="size-full" />,
						onTrue: () => <brand.light className="size-full" />
					})}
				</span>
			)
		}
		const weight = Boolean.match(props.small === true, {
			onFalse: Function.constant('light' as const),
			onTrue: Function.constant('regular' as const)
		})
		if (props.container === true) return <CubeIcon className="size-full" weight={weight} />
		return <TerminalWindowIcon className="size-full" weight={weight} />
	}
	return (
		<span className="text-muted-foreground inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
			{/* An app's own mark, also on what is named after it, such as `stash preview` or `stash-update`. */}
			<AppMark name={String.split(props.name, /[ -]/u)[0]} fallback={mark()} />
		</span>
	)
}
