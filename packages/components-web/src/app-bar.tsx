import type {ReactNode} from 'react'

// At 32px the icon's 64 cells land on whole device pixels of a 2x screen.
export function AppBar(props: {children?: ReactNode; icon: string; name: string}) {
	return (
		<header className="border-border flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
			<a href="/" className="-ml-1 flex shrink-0 items-center gap-1.5">
				<img src={props.icon} alt="" className="pixelated size-8" />
				<span className="font-mono text-sm font-medium">{props.name}</span>
			</a>
			{props.children}
		</header>
	)
}
