import {useAtomValue} from '@effect/atom-react'

import {Boolean, Effect, Option, Schema, String, pipe} from 'effect'

import {useRender} from '@base-ui/react/use-render'
import {CaretLeftIcon, MagnifyingGlassIcon} from '@phosphor-icons/react'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useEffect, useState} from 'react'
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
				render={<Button variant="ghost" size="icon-sm" className="max-sm:size-11" />}
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

// A section of the app as a hard block in the masthead; the current one carries the shared orange signal.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'tracking-label text-meta flex h-8 shrink-0 items-center justify-center border-2 px-4 font-semibold uppercase transition-colors duration-100 motion-reduce:transition-none max-sm:h-12 max-sm:flex-1 max-sm:border-0 max-sm:border-r-2 max-sm:last:border-r-0',
				Boolean.match(props.active, {
					onFalse: () => 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
					onTrue: () => 'border-signal bg-signal text-signal-foreground'
				})
			)
		},
		render: props.render
	})
}

// The search is a boxed cell at the masthead's right edge, not a floating field.
function SearchTrigger(props: {label: string; onClick: () => void}) {
	return (
		<>
			<Button
				variant="search"
				size="search"
				aria-label={props.label}
				onClick={props.onClick}
				className="hidden lg:flex xl:w-80"
			>
				<MagnifyingGlassIcon className="size-4 shrink-0" />
				<span className="text-2xs tracking-label flex-1 truncate text-left font-mono uppercase">Search or jump</span>
				<Kbd>⌘K</Kbd>
			</Button>
			<Button variant="outline" size="icon" aria-label={props.label} onClick={props.onClick} className="lg:hidden">
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}

// The masthead: a 20% mark block, block tabs, then the search and controls that choose what the page shows, each in its own cell.
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
			<header className="bg-background border-rule-strong sticky top-0 z-30 flex shrink-0 flex-col border-b-2">
				<div className="flex flex-wrap items-stretch sm:h-18 sm:flex-nowrap">
					<div className="border-border sm:bg-surface flex min-w-0 flex-1 items-center gap-3 px-4 max-sm:h-14 sm:w-1/5 sm:max-w-80 sm:flex-none sm:border-r-2 sm:px-6">
						{Option.match(Option.fromUndefinedOr(props.title), {
							onNone: () => (
								<a href="/" aria-label={props.name} className="flex min-w-0 items-center gap-3 max-sm:h-11">
									<img src={props.icon} alt="" className="pixelated size-8 shrink-0 opacity-90" />
									<span className="font-heading tracking-heading min-w-0 truncate text-xl leading-none uppercase sm:text-2xl">
										{props.name}
									</span>
								</a>
							),
							// The leading slot keeps its width on every pane, so the title and the right controls never move.
							onSome: title => (
								<div className="flex min-w-0 flex-1 items-center gap-2">
									{Option.match(Option.fromUndefinedOr(props.back), {
										onNone: () => (
											<a
												href="/"
												aria-label={props.name}
												className="flex size-9 shrink-0 items-center justify-center max-sm:size-11"
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
									<span className="font-heading tracking-title max-w-56 min-w-0 truncate text-lg leading-none sm:text-xl">
										{title}
									</span>
								</div>
							)
						})}
					</div>
					{props.tabs !== undefined && (
						<nav
							aria-label="Sections"
							className="border-border order-last flex h-12 w-full items-stretch border-t-2 sm:order-none sm:h-full sm:w-auto sm:items-center sm:gap-2 sm:border-t-0 sm:px-4"
						>
							{props.tabs}
						</nav>
					)}
					<div className="flex min-w-0 flex-1 items-stretch justify-end max-sm:h-14">
						<div className="flex items-center px-3 sm:px-4">
							{Option.match(Option.fromUndefinedOr(props.palette), {
								onNone: () => null,
								onSome: () => <SearchTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
							})}
						</div>
						<div className="border-border flex shrink-0 items-center gap-2 border-l-2 pr-2 pl-3 sm:pr-3 sm:pl-4">
							{props.controls}
							{props.account ?? <AccountMenu />}
						</div>
					</div>
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
