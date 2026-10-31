import type {ReactNode} from 'react'

// Every app's top bar: its pixel icon and lowercase name in mono, with the app's own controls on the right.
export function AppBar(props: {children?: ReactNode; icon: string; name: string}) {
	return (
		<header className="border-border flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
			<a href="/" className="flex items-center gap-2">
				<img src={props.icon} alt="" className="size-5 rounded-sm" />
				<span className="font-mono text-sm font-medium">{props.name}</span>
			</a>
			{props.children}
		</header>
	)
}
