import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Effect, Option, Schema, String, pipe} from 'effect'

import {Autocomplete} from '@base-ui/react/autocomplete'
import {useRender} from '@base-ui/react/use-render'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {ChevronLeft, Search} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'
import {flushSync} from 'react-dom'

import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button, buttonVariants} from '#components/ui/button.tsx'
import {ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList} from '#components/ui/combobox.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'
import {InputGroupAddon} from '#components/ui/input-group.tsx'
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

// What the bar's command field holds: the page narrows its rows to it while the field lists the matching actions.
const commandQueryAtom = Atom.keepAlive(Atom.make(''))

export function useCommandQuery() {
	return String.toLowerCase(String.trim(useAtomValue(commandQueryAtom)))
}

export type BarCommand = {icon: ReactNode; label: string; run: () => unknown}

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

// Typing narrows the page's rows and lists the matching actions; ⌘K focuses it. A phone opens it from a button, over the bar.
function CommandField(props: {commands: BarCommand[]; label: string}) {
	const [query, setQuery] = useAtom(commandQueryAtom)
	const [open, setOpen] = useState(false)
	// A filter still applied when the page comes back keeps its field in view.
	const [searching, setSearching] = useState(() => query !== '')
	const input = useRef<HTMLInputElement>(null)
	const field = useRef<HTMLDivElement>(null)
	useEffect(() => {
		function focus(event: KeyboardEvent) {
			if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
			event.preventDefault()
			setSearching(true)
			input.current?.focus()
		}
		addEventListener('keydown', focus)
		return () => removeEventListener('keydown', focus)
	}, [])
	const matching = Array.filter(props.commands, command =>
		String.includes(String.toLowerCase(String.trim(query)))(String.toLowerCase(command.label))
	)
	return (
		<>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={props.label}
				className="ml-auto sm:hidden"
				onClick={() => {
					// iOS raises the keyboard only for a focus inside the tap, so the field renders before this handler ends.
					flushSync(() => setSearching(true))
					input.current?.focus()
				}}
			>
				<Search />
			</Button>
			{/* Centered on the page, not in the space the name and actions leave; the list of actions hangs from the whole field. */}
			<div
				ref={field}
				className={cn(
					'mx-auto hidden w-full max-w-sm sm:flex lg:absolute lg:left-1/2 lg:-translate-x-1/2',
					searching &&
						'max-sm:bg-background max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:flex max-sm:max-w-none max-sm:items-center max-sm:gap-2 max-sm:px-3'
				)}
			>
				<Autocomplete.Root
					items={matching}
					filter={null}
					itemToStringValue={(command: BarCommand) => command.label}
					value={query}
					onValueChange={(value, details) => {
						if (details.reason !== 'item-press') setQuery(value)
					}}
					open={open && Array.isArrayNonEmpty(matching)}
					onOpenChange={setOpen}
					autoHighlight
				>
					<ComboboxInput
						ref={input}
						aria-label={props.label}
						placeholder="Search or run a command"
						showTrigger={false}
						showClear={query !== ''}
						className="w-full"
						onFocus={() => setOpen(true)}
						// The first Escape closes the list of actions; the next clears the field and leaves it.
						onKeyDown={event => {
							if (event.key !== 'Escape' || (open && Array.isArrayNonEmpty(matching))) return
							setQuery('')
							setSearching(false)
							event.currentTarget.blur()
						}}
					>
						<InputGroupAddon>
							<Search />
						</InputGroupAddon>
						{query === '' && (
							<InputGroupAddon align="inline-end" className="max-sm:hidden">
								<Kbd>⌘K</Kbd>
							</InputGroupAddon>
						)}
					</ComboboxInput>
					<ComboboxContent anchor={field}>
						<ComboboxList>
							{(command: BarCommand) => (
								<ComboboxItem
									key={command.label}
									value={command}
									onClick={() => {
										setQuery('')
										setSearching(false)
										command.run()
									}}
								>
									{command.icon}
									{command.label}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Autocomplete.Root>
				<Button
					variant="ghost"
					size="sm"
					className="sm:hidden"
					onClick={() => {
						setQuery('')
						setSearching(false)
					}}
				>
					Cancel
				</Button>
			</div>
		</>
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
	commands?: BarCommand[]
	icon: string
	name: string
	tabs?: ReactNode
	title?: string
}) {
	return (
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
					<div className="-ml-1 flex shrink-0 items-center gap-1.5">
						{Option.match(Option.fromUndefinedOr(props.back), {
							onNone: () => (
								<a href="/" aria-label={props.name} className="flex size-8 items-center justify-center">
									<img src={props.icon} alt="" className="pixelated size-8" />
								</a>
							),
							onSome: back => (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={back.label}
									onClick={back.onClick}
									className="size-8"
								>
									<ChevronLeft className="size-5" />
								</Button>
							)
						})}
						<span className="max-w-40 truncate font-mono text-sm font-medium">{title}</span>
					</div>
				)
			})}
			{props.tabs !== undefined && (
				<nav aria-label="Sections" className="ml-2 flex items-center gap-1">
					{props.tabs}
				</nav>
			)}
			{props.commands === undefined && <span className="flex-1" />}
			{props.commands !== undefined && <CommandField commands={props.commands} label={`Search ${props.name}`} />}
			<div className="flex shrink-0 items-center gap-2 lg:ml-auto">
				{props.action}
				{props.account ?? <AccountMenu />}
			</div>
		</header>
	)
}
