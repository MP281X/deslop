import {useAtomValue} from '@effect/atom-react'

import {Boolean, Effect, Option, Schema, String, pipe} from 'effect'

import {useRender} from '@base-ui/react/use-render'
import {CaretLeftIcon} from '@phosphor-icons/react'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useEffect, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {CommandPalette, CommandTrigger} from '#components/command-palette.tsx'
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
import {cn} from '#lib/utils.ts'

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
			<DropdownMenuTrigger
				aria-label="Account"
				render={<Button variant="ghost" size="icon" className="max-sm:size-11" />}
			>
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
					className="max-sm:h-11"
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
			className: cn(
				buttonVariants({
					variant: Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})
				}),
				'max-sm:h-11'
			),
			'data-slot': 'button'
		},
		render: props.render
	})
}

// Actions live in the palette; `controls` only choose what the page shows, such as Deploy's range. `account` replaces the shared menu.
export function AppBar(props: {
	account?: ReactNode
	back?: {label: string; onClick: () => void}
	controls?: ReactNode
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
			<header className="bg-background text-muted-foreground border-border sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3">
				{Option.match(Option.fromUndefinedOr(props.title), {
					onNone: () => (
						<a href="/" className="flex shrink-0 items-center gap-2 max-sm:h-11">
							<img src={props.icon} alt="" className="pixelated size-8 opacity-60" />
							<span className="text-sm font-semibold">{props.name}</span>
						</a>
					),
					// The leading slot keeps its width on every pane, so the title and the right controls never move.
					onSome: title => (
						<div className="flex min-w-0 shrink items-center gap-1.5">
							{Option.match(Option.fromUndefinedOr(props.back), {
								onNone: () => (
									<a
										href="/"
										aria-label={props.name}
										className="flex size-8 shrink-0 items-center justify-center max-sm:size-11"
									>
										<img src={props.icon} alt="" className="pixelated size-8 opacity-60" />
									</a>
								),
								onSome: back => (
									<Button
										variant="ghost"
										size="icon"
										className="max-sm:size-11"
										aria-label={back.label}
										onClick={back.onClick}
									>
										<CaretLeftIcon className="size-4" />
									</Button>
								)
							})}
							<span className="max-w-40 min-w-0 truncate text-sm font-medium">{title}</span>
						</div>
					)
				})}
				{props.tabs !== undefined && (
					<nav aria-label="Sections" className="flex items-center gap-1">
						{props.tabs}
					</nav>
				)}
				<div className="flex min-w-0 flex-1 items-center justify-end">
					{Option.match(Option.fromUndefinedOr(props.palette), {
						onNone: () => null,
						onSome: () => <CommandTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
					})}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{props.controls}
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
