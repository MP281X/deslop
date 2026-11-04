import {useAtomValue} from '@effect/atom-react'

import {Boolean, Effect, Option, Schema, String, pipe} from 'effect'

import {useRender} from '@base-ui/react/use-render'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {ChevronLeft} from 'lucide-react'
import {useEffect, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {CommandIcon, CommandPalette, CommandTrigger} from '#components/command-palette.tsx'
import type {PaletteGroup} from '#components/command-palette.tsx'
import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button, buttonVariants} from '#components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'

type Account = typeof Account.Type
// The signed-in account every Deslop server answers at /auth/user; without an issuer it is the developer, who cannot sign out.
const Account = Schema.Struct({id: Schema.String, name: Schema.String, signOut: Schema.Boolean})

const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(
	pipe(
		HttpClient.get('/auth/user'),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
	)
)

// GitHub's avatar for the account; signing out goes through Auth, which ends the session every app shares.
function AccountMenu() {
	const account = useAtomValue(accountAtom)
	if (!AsyncResult.isSuccess(account)) return null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger aria-label="Account">
				<Avatar size="sm">
					<AvatarImage
						src={`https://avatars.githubusercontent.com/u/${String.replace('github:', '')(account.value.id)}?s=96`}
						alt={account.value.name}
					/>
					<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(account.value.name))}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>@{account.value.name}</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					disabled={!account.value.signOut}
					render={<a aria-label="Sign out" href={`/auth/sign-out?${new URLSearchParams({next: location.href})}`} />}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// A section of the app as a tab in the bar, the current one filled; `render` is the router's link.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: buttonVariants({
				variant: Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})
			})
		},
		render: props.render
	})
}

// A page action in the bar, its label folding away on a phone.
export function AppBarAction(props: {
	disabled?: boolean
	icon: ReactNode
	label: string
	onClick: () => void
	variant?: 'default' | 'outline'
}) {
	return (
		<Button aria-label={props.label} variant={props.variant} disabled={props.disabled} onClick={props.onClick}>
			{props.icon}
			<span className="max-sm:hidden">{props.label}</span>
		</Button>
	)
}

// At 32px a 64-cell mark lands on whole device pixels of a 2x screen. `account` replaces the shared menu, as Auth's own does.
export function AppBar(props: {
	account?: ReactNode
	action?: ReactNode
	back?: {label: string; onClick: () => void}
	icon: string
	name: string
	palette?: readonly PaletteGroup[]
	tabs?: ReactNode
	title?: string
}) {
	const [paletteOpen, setPaletteOpen] = useState(false)
	useEffect(() => {
		if (props.palette === undefined) return
		function open(event: KeyboardEvent) {
			if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
			event.preventDefault()
			setPaletteOpen(true)
		}
		addEventListener('keydown', open)
		return () => removeEventListener('keydown', open)
	}, [props.palette])
	return (
		<>
			<header className="bg-background border-border sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4">
				{Option.match(Option.fromUndefinedOr(props.title), {
					onNone: () => (
						<a href="/" className="-ml-1 flex shrink-0 items-center gap-1.5">
							<img src={props.icon} alt="" className="pixelated size-8" />
							<span className="font-mono text-sm font-medium">{props.name}</span>
						</a>
					),
					// The leading slot keeps its width on every pane, so the title and the right controls never move.
					onSome: title => (
						<div className="-ml-1 flex min-w-0 shrink items-center gap-1.5">
							{Option.match(Option.fromUndefinedOr(props.back), {
								onNone: () => (
									<a href="/" aria-label={props.name} className="flex size-8 shrink-0 items-center justify-center">
										<img src={props.icon} alt="" className="pixelated size-8" />
									</a>
								),
								onSome: back => (
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={back.label}
										onClick={back.onClick}
										className="size-8 shrink-0"
									>
										<ChevronLeft className="size-5" />
									</Button>
								)
							})}
							<span className="max-w-40 min-w-0 truncate font-mono text-sm font-medium">{title}</span>
						</div>
					)
				})}
				{props.tabs !== undefined && (
					<nav aria-label="Sections" className="ml-2 flex items-center gap-1">
						{props.tabs}
					</nav>
				)}
				{Option.match(Option.fromUndefinedOr(props.palette), {
					onNone: () => <span className="flex-1" />,
					onSome: () => (
						<>
							<CommandTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
							<CommandIcon label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
						</>
					)
				})}
				<div className="flex shrink-0 items-center gap-2 lg:ml-auto">
					{props.action}
					{props.account ?? <AccountMenu />}
				</div>
			</header>
			{Option.match(Option.fromUndefinedOr(props.palette), {
				onNone: () => null,
				onSome: groups => (
					<CommandPalette current={props.name} groups={groups} open={paletteOpen} onOpenChange={setPaletteOpen} />
				)
			})}
		</>
	)
}
