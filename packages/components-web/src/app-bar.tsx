import {useAtomValue} from '@effect/atom-react'

import {Boolean, Effect, Option, Schema, String, pipe} from 'effect'

import {useRender} from '@base-ui/react/use-render'
import {CaretLeftIcon, MagnifyingGlassIcon} from '@phosphor-icons/react'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useEffect, useRef, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {CommandPalette} from '#components/command-palette.tsx'
import type {PaletteGroup} from '#components/command-palette.tsx'
import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button} from '#components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'
import {Kbd} from '#components/ui/kbd.tsx'
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
				render={<Button variant="ghost" size="icon-circle" className="max-sm:size-11" />}
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

// A section of the app as a pill in the floating masthead, the current one filled with cyan-tinted glass.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium tracking-normal transition-colors duration-150 max-md:h-11',
				Boolean.match(props.active, {
					onFalse: () => 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
					onTrue: () => 'bg-selection text-foreground ring-1 ring-primary/25'
				})
			)
		},
		render: props.render
	})
}

// The masthead: mark and name, pill sections, the page-wide search and the controls that choose what the page shows.
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
	const desktopTrigger = useRef<HTMLButtonElement>(null)
	const mobileTrigger = useRef<HTMLButtonElement>(null)
	const fromTrigger = useRef(false)
	useEffect(() => {
		if (props.palette === undefined) return
		function open(event: KeyboardEvent) {
			if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
			event.preventDefault()
			fromTrigger.current = false
			setPaletteOpen(true)
		}
		addEventListener('keydown', open)
		return () => removeEventListener('keydown', open)
	}, [props.palette])
	// A palette opened from the search control returns focus there, so the keyboard path never loses its place.
	function changePalette(open: boolean) {
		setPaletteOpen(open)
		if (open) return
		if (fromTrigger.current) {
			fromTrigger.current = false
			requestAnimationFrame(() => {
				if (desktopTrigger.current !== null && desktopTrigger.current.offsetParent !== null) {
					desktopTrigger.current.focus()
					return
				}
				mobileTrigger.current?.focus()
			})
		}
	}
	return (
		<>
			<div className="shrink-0 px-2 pt-2 sm:px-4 sm:pt-4">
				<header className="glass-bar relative z-30 flex h-13 items-center gap-2 rounded-2xl px-2.5 sm:h-14 sm:gap-4 sm:px-3.5">
					{Option.match(Option.fromUndefinedOr(props.title), {
						onNone: () => (
							<a
								href="/"
								aria-label={props.name}
								className="hover:bg-accent/60 flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-1.5 transition-colors max-sm:h-11"
							>
								<img src={props.icon} alt="" className="pixelated size-7 opacity-90" />
								<span className="font-heading text-base leading-none font-semibold tracking-tight capitalize">
									{props.name}
								</span>
							</a>
						),
						// The leading slot keeps its width on every pane, so the title and the right controls never move.
						onSome: title => (
							<div className="flex min-w-0 shrink items-center gap-1">
								{Option.match(Option.fromUndefinedOr(props.back), {
									onNone: () => (
										<a
											href="/"
											aria-label={props.name}
											className="hover:bg-accent/60 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors max-sm:size-11"
										>
											<img src={props.icon} alt="" className="pixelated size-7 opacity-90" />
										</a>
									),
									onSome: back => (
										<Button
											variant="ghost"
											size="icon-sm"
											className="max-sm:size-11"
											aria-label={back.label}
											onClick={back.onClick}
										>
											<CaretLeftIcon className="size-4" />
										</Button>
									)
								})}
								<span className="font-heading max-w-48 min-w-0 truncate px-1 text-base leading-none font-semibold tracking-tight">
									{title}
								</span>
							</div>
						)
					})}
					{Option.match(Option.fromUndefinedOr(props.tabs), {
						onNone: () => <div className="min-w-0 flex-1" />,
						onSome: tabs => (
							<nav aria-label="Sections" className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 md:flex">
								{tabs}
							</nav>
						)
					})}
					<div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2">
						{Option.match(Option.fromUndefinedOr(props.palette), {
							onNone: () => null,
							onSome: () => (
								<>
									<Button
										ref={desktopTrigger}
										variant="search"
										size="search"
										aria-label={`Search ${props.name}`}
										onClick={() => {
											fromTrigger.current = true
											setPaletteOpen(true)
										}}
										className="hidden w-60 xl:flex"
									>
										<MagnifyingGlassIcon className="size-3.5 shrink-0" />
										<span className="flex-1 truncate text-left">Search or jump to…</span>
										<Kbd>⌘K</Kbd>
									</Button>
									<Button
										ref={mobileTrigger}
										variant="ghost"
										size="icon-circle"
										aria-label={`Search ${props.name}`}
										onClick={() => {
											fromTrigger.current = true
											setPaletteOpen(true)
										}}
										className="max-sm:size-11 xl:hidden"
									>
										<MagnifyingGlassIcon />
									</Button>
								</>
							)
						})}
						{props.controls}
						{props.account ?? <AccountMenu />}
					</div>
				</header>
				{Option.match(Option.fromUndefinedOr(props.tabs), {
					onNone: () => null,
					onSome: tabs => (
						<nav aria-label="Sections" className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 md:hidden">
							{tabs}
						</nav>
					)
				})}
			</div>
			{Option.match(Option.fromUndefinedOr(props.palette), {
				onNone: () => null,
				onSome: groups => (
					<CommandPalette current={props.name} groups={groups} open={paletteOpen} onOpenChange={changePalette} />
				)
			})}
		</>
	)
}
