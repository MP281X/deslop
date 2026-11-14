import {useAtomValue} from '@effect/atom-react'

import {Array, Effect, Option, String, pipe} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import type {ComponentType, ReactNode, SVGProps} from 'react'

import {appMarks} from '#lib/apps.ts'
import {cn} from '#lib/utils.ts'

// The first of the sources that loads, probed off the page so a missing image never draws the browser's broken one.
const firstImageAtom = Atom.family((sources: string) =>
	Atom.make(
		Effect.firstSuccessOf(
			pipe(
				sources,
				String.split('\n'),
				Array.map(src =>
					Effect.callback<string, string>(resume => {
						const image = new Image()
						image.addEventListener('load', () => {
							resume(Effect.succeed(src))
						})
						image.addEventListener('error', () => {
							resume(Effect.fail(src))
						})
						image.src = src
					})
				)
			)
		)
	)
)

// A row's image mark, filling the square it is placed in: the first source that loads, else the glyph.
export function ImageMark(props: {fallback: ReactNode; sources: readonly [string, ...string[]]}) {
	return Option.match(AsyncResult.value(useAtomValue(firstImageAtom(Array.join(props.sources, '\n')))), {
		onNone: () => props.fallback,
		onSome: src => <img src={src} alt="" className="size-full object-contain" />
	})
}

// A Deslop app's own pixel mark, filling the square it is placed in, or the fallback for anything that is not one of the apps.
export function AppMark(props: {fallback: ReactNode; name: string}) {
	return Option.match(Option.fromUndefinedOr(appMarks[props.name]), {
		onNone: () => props.fallback,
		onSome: mark => <img src={mark} alt="" className="pixelated size-full" />
	})
}

// A software mark the registry ships as light and dark artwork; only the one the appearance calls for is drawn.
export function ThemedMark(props: {
	className?: string
	dark: ComponentType<SVGProps<SVGSVGElement>>
	light: ComponentType<SVGProps<SVGSVGElement>>
}) {
	return (
		<>
			<props.light aria-hidden className={cn(props.className, 'dark:hidden')} />
			<props.dark aria-hidden className={cn(props.className, 'hidden dark:block')} />
		</>
	)
}
