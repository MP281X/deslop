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
				render={<Button variant="ghost" size="icon-sm" className="max-sm:size-12" />}
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

// A section of the app as a labelled switch in the masthead; only the active switch lights its LED.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'text-stamp relative flex h-9 shrink-0 items-center gap-2 rounded-sm border-2 px-3 font-mono font-semibold tracking-widest whitespace-nowrap uppercase transition duration-140 before:size-1.5 before:shrink-0 before:rounded-full before:border before:transition-colors',
				Boolean.match(props.active, {
					onFalse: () =>
						'border-transparent text-muted-foreground before:border-muted-foreground before:bg-transparent hover:border-border hover:bg-secondary hover:text-foreground',
					onTrue: () =>
						'border-border bg-card text-foreground before:border-primary before:bg-primary after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:bg-primary'
				})
			)
		},
		render: props.render
	})
}

// Search is an inset slot in the panel's right rail, with the palette key already fitted into it.
function SearchTrigger(props: {label: string; onClick: () => void}) {
	return (
		<>
			<Button
				variant="search"
				size="search"
				aria-label={props.label}
				onClick={props.onClick}
				className="hidden w-64 xl:flex"
			>
				<MagnifyingGlassIcon className="size-4 shrink-0" />
				<span className="flex-1 truncate text-left">Search or jump to…</span>
				<Kbd>⌘K</Kbd>
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={props.label}
				onClick={props.onClick}
				className="max-sm:size-12 xl:hidden"
			>
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}

// The masthead: mark and name, sections, the page-wide search, then the controls that choose what the page shows. Actions live in the palette.
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
			{/* A control panel: a 64px labelled rail, with a 36px switch row on a phone. */}
			<header className="bg-card sticky top-0 z-30 flex shrink-0 flex-col border-b-2">
				<div className="flex h-16 shrink-0 items-center gap-4 px-6 max-sm:h-14 max-sm:gap-2 max-sm:px-4">
					{Option.match(Option.fromUndefinedOr(props.title), {
						onNone: () => (
							<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-3 max-sm:h-12">
								<span className="bg-primary flex size-9 shrink-0 items-center justify-center rounded-sm max-sm:size-8">
									<img src={props.icon} alt="" className="pixelated size-7 max-sm:size-6" />
								</span>
								<span className="font-heading text-xl leading-none tracking-tight capitalize max-sm:text-lg">
									{props.name}
								</span>
							</a>
						),
						// The leading slot keeps its width on every pane, so the title and the right controls never move.
						onSome: title => (
							<div className="flex min-w-0 shrink items-center gap-2">
								{Option.match(Option.fromUndefinedOr(props.back), {
									onNone: () => (
										<a
											href="/"
											aria-label={props.name}
											className="flex size-9 shrink-0 items-center justify-center rounded-sm max-sm:size-12"
										>
											<span className="bg-primary flex size-9 shrink-0 items-center justify-center rounded-sm max-sm:size-8">
												<img src={props.icon} alt="" className="pixelated size-7 max-sm:size-6" />
											</span>
										</a>
									),
									onSome: back => (
										<Button
											variant="ghost"
											size="sm"
											className="max-sm:h-12"
											aria-label={back.label}
											onClick={back.onClick}
										>
											<CaretLeftIcon className="size-4" />
											{back.label}
										</Button>
									)
								})}
								<span className="font-heading max-w-48 min-w-0 truncate text-xl leading-none tracking-tight">
									{title}
								</span>
							</div>
						)
					})}
					{props.tabs !== undefined && (
						<nav aria-label="Sections" className="hidden min-w-0 flex-1 items-center justify-center gap-2 sm:flex">
							{props.tabs}
						</nav>
					)}
					<div className="ml-auto flex min-w-0 items-center justify-end gap-2 self-stretch">
						{Option.match(Option.fromUndefinedOr(props.palette), {
							onNone: () => null,
							onSome: () => <SearchTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
						})}
						{props.controls}
						{props.account ?? <AccountMenu />}
					</div>
				</div>
				{props.tabs !== undefined && (
					<nav
						aria-label="Sections"
						className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-t-2 px-4 sm:hidden"
					>
						{props.tabs}
					</nav>
				)}
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
