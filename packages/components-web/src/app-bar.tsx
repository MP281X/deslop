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

// A section of the app as a quiet label in the masthead, the current one ruled in the cursor's violet.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'relative flex h-12 shrink-0 items-center gap-1.5 px-0.5 text-xs font-medium tracking-normal transition-colors duration-100',
				Boolean.match(props.active, {
					onFalse: () => 'text-muted-foreground hover:text-foreground',
					onTrue: () => 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-primary'
				})
			)
		},
		render: props.render
	})
}

// The command trigger: a compact key in the left cluster on desktop; touch keeps a search icon on the right.
function SearchTrigger(props: {label: string; onClick: () => void}) {
	return (
		<Button
			variant="command"
			size="command"
			aria-label={props.label}
			onClick={props.onClick}
			className="hidden sm:flex"
		>
			<MagnifyingGlassIcon className="size-3.5 shrink-0" />
			<span className="max-xl:sr-only">Search</span>
			<Kbd>⌘K</Kbd>
		</Button>
	)
}

// The 48px masthead: mark and name, the command key, quiet sections, then the controls that choose what the page shows. Actions live in the palette.
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
			<header className="bg-background/95 supports-backdrop-filter:bg-background/85 relative sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-md sm:px-8">
				{Option.match(Option.fromUndefinedOr(props.title), {
					onNone: () => (
						<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-2 max-sm:h-11">
							<img src={props.icon} alt="" className="pixelated size-6 opacity-90" />
							<span className="text-title leading-none font-semibold tracking-tight capitalize">{props.name}</span>
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
										className="flex size-8 shrink-0 items-center justify-center max-sm:size-11"
									>
										<img src={props.icon} alt="" className="pixelated size-6 opacity-90" />
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
							<span className="text-title max-w-48 min-w-0 truncate leading-none font-semibold tracking-tight">
								{title}
							</span>
						</div>
					)
				})}
				{Option.match(Option.fromUndefinedOr(props.palette), {
					onNone: () => null,
					onSome: () => <SearchTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
				})}
				<div className="flex min-w-0 flex-1 items-center justify-center max-sm:justify-start">
					{props.tabs !== undefined && (
						<nav aria-label="Sections" className="flex min-w-0 items-center gap-4 max-sm:gap-3 max-sm:overflow-x-auto">
							{props.tabs}
						</nav>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{Option.match(Option.fromUndefinedOr(props.palette), {
						onNone: () => null,
						onSome: () => (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Search ${props.name}`}
								onClick={() => setPaletteOpen(true)}
								className="max-sm:size-11 sm:hidden"
							>
								<MagnifyingGlassIcon />
							</Button>
						)
					})}
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
