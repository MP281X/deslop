import {useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Clock, DateTime, Effect, Number, Option, Schema, Stream, String, pipe} from 'effect'

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
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '#components/ui/dialog.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'
import {Kbd, KbdGroup} from '#components/ui/kbd.tsx'
import {cn} from '#lib/utils.ts'

type Account = typeof Account.Type
// The signed-in account every Deslop server answers at /auth/user; without an issuer it is the developer, who cannot sign out.
const Account = Schema.Struct({id: Schema.String, name: Schema.String, signOut: Schema.Boolean})

// The key rail's clock: one Effect stream, so the console has no browser timer of its own.
const clockAtom = Atom.make(
	Stream.unwrap(
		Effect.map(Clock.currentTimeMillis, () => Stream.map(Stream.tick('1 second'), () => DateTime.nowUnsafe()))
	)
)
const clockFormat = new Intl.DateTimeFormat(undefined, {
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	second: '2-digit'
})

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

// A section of the app as a bracketed console word in the command strip; the current one carries the blue fill.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: (
				<>
					<span aria-hidden className="opacity-50">
						[
					</span>
					{props.children}
					<span aria-hidden className="opacity-50">
						]
					</span>
				</>
			),
			className: cn(
				'focus-visible:ring-ring/50 relative flex h-6 shrink-0 items-center gap-1.5 rounded-xs px-1.5 font-mono text-xs font-medium whitespace-nowrap transition-colors duration-75 outline-none select-none focus-visible:ring-2 max-sm:h-11',
				Boolean.match(props.active, {
					onFalse: () => 'text-muted-foreground hover:bg-secondary hover:text-foreground',
					onTrue: () => 'bg-signal/15 text-signal'
				})
			)
		},
		render: props.render
	})
}

// The command strip's right-hand search: a visible ⌘K on a pointer, a 44px icon on a phone.
function CommandTrigger(props: {label: string; onClick: () => void}) {
	return (
		<>
			<Button variant="command" size="xs" aria-label={props.label} onClick={props.onClick} className="hidden sm:flex">
				<span className="hidden lg:inline">search</span>
				<Kbd>⌘K</Kbd>
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={props.label}
				onClick={props.onClick}
				className="max-sm:size-11 sm:hidden"
			>
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}

function isTyping(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return (
		target.isContentEditable ||
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT'
	)
}

// The shortcuts sheet: one small popover of the keys the console has taught.
function KeysSheet(props: {name: string; onOpenChange: (open: boolean) => void; open: boolean; palette: boolean}) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogTitle>Keys</DialogTitle>
				<DialogDescription className="sr-only">Keyboard shortcuts for {props.name}.</DialogDescription>
				<dl className="grid-cols-keys grid items-center gap-x-4 gap-y-2 font-mono text-xs">
					{props.palette && (
						<>
							<dt>
								<KbdGroup>
									<Kbd>/</Kbd>
									<Kbd>⌘K</Kbd>
								</KbdGroup>
							</dt>
							<dd className="text-muted-foreground">Search and commands</dd>
						</>
					)}
					<dt>
						<KbdGroup>
							<Kbd>j</Kbd>
							<Kbd>k</Kbd>
						</KbdGroup>
					</dt>
					<dd className="text-muted-foreground">Move through rows</dd>
					<dt>
						<Kbd>enter</Kbd>
					</dt>
					<dd className="text-muted-foreground">Open the focused row</dd>
					<dt>
						<Kbd>esc</Kbd>
					</dt>
					<dd className="text-muted-foreground">Close this sheet</dd>
					<dt>
						<Kbd>?</Kbd>
					</dt>
					<dd className="text-muted-foreground">Show these keys</dd>
				</dl>
			</DialogContent>
		</Dialog>
	)
}

// ⌘K and / open the palette only when the app has one; both keys stay inert otherwise.
function openPalette(event: KeyboardEvent, palette: boolean, open: () => void) {
	if (!palette) return
	event.preventDefault()
	open()
}

// j, k and Enter move through the first visible row set, or open the focused row with a click and the rest through its context menu.
function navigateRows(event: KeyboardEvent) {
	const rows = Array.filter(
		Array.fromIterable(document.querySelectorAll<HTMLElement>('[data-row]')),
		row => row.getClientRects().item(0) !== null
	)
	if (Array.isArrayEmpty(rows)) return
	const index = Option.getOrElse(
		Array.findFirstIndex(rows, row => row === document.activeElement),
		() => -1
	)
	if (event.key === 'Enter') {
		if (index < 0) return
		event.preventDefault()
		const row = rows[index]
		if (row === undefined) return
		if (row.matches('[data-slot="context-menu-trigger"]')) {
			const rect = row.getBoundingClientRect()
			row.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: rect.left + rect.width / 2,
					clientY: rect.top + rect.height / 2
				})
			)
		} else {
			row.click()
		}
		return
	}
	event.preventDefault()
	const targetIndex = Boolean.match(index < 0, {
		onFalse: () =>
			Boolean.match(event.key === 'j', {
				onFalse: () => Number.max(0, index - 1),
				onTrue: () => Number.min(rows.length - 1, index + 1)
			}),
		onTrue: () => 0
	})
	const target = rows[targetIndex]
	target?.focus()
	target?.scrollIntoView({block: 'nearest'})
}

// The masthead: a 40px command strip with the app's path, bracketed sections, ⌘K and the account, then a thin key rail.
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
	const [keysOpen, setKeysOpen] = useState(false)
	const palette = Option.isSome(Option.fromUndefinedOr(props.palette))
	const clock = pipe(
		AsyncResult.value(useAtomValue(clockAtom)),
		Option.map(now => clockFormat.format(DateTime.toEpochMillis(now))),
		Option.getOrElse(() => '--:--:--')
	)
	useEffect(() => {
		function open(event: KeyboardEvent) {
			if (event.defaultPrevented) return
			if ((event.metaKey || event.ctrlKey) && String.toLowerCase(event.key) === 'k') {
				openPalette(event, palette, () => setPaletteOpen(true))
				return
			}
			if (event.metaKey || event.ctrlKey || event.altKey) return
			if (document.querySelector('[data-slot="dialog-content"][data-open]') !== null || isTyping(event.target)) return
			if (event.key === '/') {
				openPalette(event, palette, () => setPaletteOpen(true))
				return
			}
			if (event.key === '?') {
				event.preventDefault()
				setKeysOpen(true)
				return
			}
			if (event.key !== 'j' && event.key !== 'k' && event.key !== 'Enter') return
			navigateRows(event)
		}
		addEventListener('keydown', open)
		return () => removeEventListener('keydown', open)
	}, [palette])
	return (
		<>
			<header className="bg-background relative sticky top-0 z-30 shrink-0 border-b">
				<div className="flex h-10 items-center gap-2 px-3 max-sm:h-11 sm:px-4">
					<div className="flex min-w-0 shrink items-center gap-1.5">
						{Option.match(Option.fromUndefinedOr(props.back), {
							onNone: () => null,
							onSome: back => (
								<Button
									variant="ghost"
									size="icon-xs"
									className="max-sm:size-11"
									aria-label={back.label}
									onClick={back.onClick}
								>
									<CaretLeftIcon />
								</Button>
							)
						})}
						<a
							href="/"
							aria-label={props.name}
							className="hover:text-primary flex min-w-0 shrink-0 items-center gap-1.5 font-mono text-xs font-medium max-sm:h-11"
						>
							<img src={props.icon} alt="" className="pixelated size-4 opacity-80 sm:hidden" />
							<span className="max-sm:hidden">~/{props.name}</span>
							{props.title === undefined && <span className="sm:hidden">[{props.name}]</span>}
						</a>
						{props.title !== undefined && (
							<>
								<span aria-hidden className="text-muted-foreground/60">
									/
								</span>
								<span className="text-muted-foreground max-w-40 min-w-0 truncate font-mono text-xs">{props.title}</span>
							</>
						)}
					</div>
					<span aria-hidden className="text-signal hidden sm:inline">
						$
					</span>
					{props.tabs !== undefined && (
						<nav
							aria-label="Sections"
							className="no-scrollbar flex h-10 min-w-0 items-center gap-1 overflow-x-auto font-mono text-xs max-sm:h-11"
						>
							{props.tabs}
						</nav>
					)}
					<div className="flex min-w-0 flex-1 items-center justify-end max-xl:min-w-2" />
					<div className="flex shrink-0 items-center gap-1">
						{Boolean.match(palette, {
							onFalse: () => null,
							onTrue: () => <CommandTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
						})}
						{props.controls}
						{props.account ?? <AccountMenu />}
					</div>
				</div>
				{/* The key rail is desktop chrome: a clock, the three moves, and the sheet that lists the rest. */}
				<div className="text-muted-foreground text-2xs hidden h-6 items-center gap-3 border-t px-4 font-mono lg:flex">
					<span className="tabular-nums">{clock}</span>
					<span aria-hidden>·</span>
					<span>
						<kbd className="text-foreground">j/k</kbd> move
					</span>
					<span aria-hidden>·</span>
					<span>
						<kbd className="text-foreground">enter</kbd> open
					</span>
					<span aria-hidden>·</span>
					<Button variant="ghost" size="xs" onClick={() => setKeysOpen(true)}>
						<kbd className="text-foreground">?</kbd> <span className="text-2xs">keys</span>
					</Button>
				</div>
			</header>
			<KeysSheet name={props.name} open={keysOpen} onOpenChange={setKeysOpen} palette={palette} />
			{Option.match(Option.fromUndefinedOr(props.palette), {
				onNone: () => null,
				onSome: groups => (
					<CommandPalette current={props.name} groups={groups} open={paletteOpen} onOpenChange={setPaletteOpen} />
				)
			})}
		</>
	)
}
