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

// A section of the app as a numbered terminal tab; the current one takes the acid rule.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'group/tab tab-index relative flex h-12 shrink-0 items-center gap-1.5 text-xs whitespace-nowrap uppercase transition-colors duration-100',
				Boolean.match(props.active, {
					onFalse: () => 'text-muted-foreground hover:text-foreground',
					onTrue: () => 'tab-active'
				})
			)
		},
		render: props.render
	})
}

// A compact terminal search trigger: `⌘K SEARCH` on a wide screen, a 44px icon on a phone.
function SearchTrigger(props: {label: string; onClick: () => void}) {
	return (
		<>
			<Button
				variant="terminal"
				size="terminal"
				aria-label={props.label}
				onClick={props.onClick}
				className="hidden md:flex"
			>
				<span className="terminal-label border-border border px-1 py-0.5">⌘K</span>
				SEARCH
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={props.label}
				onClick={props.onClick}
				className="max-sm:size-11 md:hidden"
			>
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}

function isTyping(target: EventTarget | null) {
	return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

// The masthead: mark, `[AUTH]` and name, numbered sections, the search trigger and the account; the key strip sits under the app.
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
			if (event.defaultPrevented) return
			const command = event.key === 'k' && (event.metaKey || event.ctrlKey)
			const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)
			if (!command && !slash) return
			event.preventDefault()
			setPaletteOpen(true)
		}
		addEventListener('keydown', open)
		return () => removeEventListener('keydown', open)
	}, [props.palette])
	return (
		<>
			<header className="bg-background scanlines sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-dotted px-4">
				{Option.match(Option.fromUndefinedOr(props.title), {
					onNone: () => (
						<a href="/" aria-label={props.name} className="flex h-11 shrink-0 items-center gap-2">
							<img src={props.icon} alt="" className="pixelated size-4 opacity-80" />
							<span className="text-primary text-xs leading-none">[{String.toUpperCase(props.name)}]</span>
							<span className="text-foreground hidden font-mono text-base leading-none sm:inline">{props.name}</span>
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
										className="flex size-9 shrink-0 items-center justify-center max-sm:size-11"
									>
										<img src={props.icon} alt="" className="pixelated size-5 opacity-90" />
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
							<span className="font-heading max-w-48 min-w-0 truncate text-lg leading-none">{title}</span>
						</div>
					)
				})}
				{props.tabs !== undefined && (
					<nav aria-label="Sections" className="tab-list flex h-12 min-w-0 items-center gap-4 overflow-x-auto">
						{props.tabs}
					</nav>
				)}
				<div className="flex min-w-0 flex-1 items-center justify-end">
					{Option.match(Option.fromUndefinedOr(props.palette), {
						onNone: () => null,
						onSome: () => <SearchTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
					})}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{props.controls}
					{props.account ?? <AccountMenu />}
				</div>
			</header>
			{props.palette !== undefined && (
				<footer aria-hidden="true" className="terminal-footer">
					<span>DESLOP / {String.toUpperCase(props.name)}</span>
					<span>j/k move · enter open · / search</span>
				</footer>
			)}
			{Option.match(Option.fromUndefinedOr(props.palette), {
				onNone: () => null,
				onSome: groups => (
					<CommandPalette current={props.name} groups={groups} open={paletteOpen} onOpenChange={setPaletteOpen} />
				)
			})}
		</>
	)
}
