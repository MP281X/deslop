import {Option} from 'effect'

import type {ComponentType, ReactNode, SVGProps} from 'react'

import {appMarks} from '#components/apps.ts'
import {cn} from '#lib/classes.ts'

// A Deslop app's own pixel mark at 16px, or the fallback for anything that is not one of the apps.
export function AppMark(props: {fallback: ReactNode; name: string}) {
	return Option.match(Option.fromUndefinedOr(appMarks[props.name]), {
		onNone: () => props.fallback,
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
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
