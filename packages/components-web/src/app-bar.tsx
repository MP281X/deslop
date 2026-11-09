import {useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Effect, Option, Schema, String, pipe} from 'effect'

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

// The signal at the centre of the bar: one 1px line at three amplitudes, still under reduced motion.
function wave(amplitude: number) {
	return Array.join(
		Array.makeBy(8, index => {
			const x = index * 20
			return `M${x} 10 L${x + 4} 10 Q${x + 6} ${10 - amplitude} ${x + 8} 10 T${x + 12} 10 T${x + 16} 10 L${x + 20} 10`
		}),
		' '
	)
}

function Signal() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 160 20"
			width={160}
			height={20}
			fill="none"
			stroke="currentColor"
			strokeWidth="1"
			vectorEffect="non-scaling-stroke"
			className="text-muted-foreground hidden shrink-0 lg:block"
		>
			<path d={wave(4)} className="signal-low motion-reduce:animate-none" />
			<path d={wave(9)} className="signal-mid opacity-0 motion-reduce:animate-none" />
			<path d={wave(6)} className="signal-high opacity-0 motion-reduce:animate-none" />
		</svg>
	)
}

// A section of the app as a plain mono word in the bar's second line, the current one ruled with a hairline.
export function AppBarTab(props: {active: boolean; children: ReactNode; render: ReactElement}) {
	return useRender({
		props: {
			'aria-current': Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'page' as const}),
			children: props.children,
			className: cn(
				'type-mono relative flex h-full shrink-0 items-center gap-2 whitespace-nowrap transition-colors duration-150',
				Boolean.match(props.active, {
					onFalse: () => 'text-muted-foreground hover:text-foreground',
					onTrue: () => 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-foreground'
				})
			)
		},
		render: props.render
	})
}

// The command palette stays a word, not a box: the search text and its key sit at the end of the tab line.
function SearchText(props: {label: string; onClick: () => void}) {
	return (
		<Button
			type="button"
			variant="bare"
			size="bare"
			aria-label={props.label}
			onClick={props.onClick}
			className="hidden shrink-0 sm:inline-flex"
		>
			search
			<Kbd>⌘K</Kbd>
		</Button>
	)
}

function SearchIcon(props: {label: string; onClick: () => void}) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={props.label}
			onClick={props.onClick}
			className="size-11 shrink-0 sm:hidden"
		>
			<MagnifyingGlassIcon />
		</Button>
	)
}

// The masthead: a 56px wordmark and signal line, then a 32px control line of words, tabs and search. Actions live in the palette.
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
	const secondLine = props.tabs !== undefined || props.palette !== undefined
	return (
		<>
			<header className="bg-background/90 supports-backdrop-filter:bg-background/80 relative sticky top-0 z-30 shrink-0 border-b backdrop-blur-md">
				<div className="relative flex h-16 items-center gap-3 px-6 sm:h-14 sm:px-8">
					{Option.match(Option.fromUndefinedOr(props.title), {
						onNone: () => (
							<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-2.5 max-sm:h-11">
								<img src={props.icon} alt="" className="pixelated size-5 opacity-90" />
								<span className="type-body font-mono leading-none lowercase">{props.name}</span>
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
								<span className="font-heading max-w-48 min-w-0 truncate text-2xl leading-none">{title}</span>
							</div>
						)
					})}
					<div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
						<Signal />
					</div>
					<div className="ml-auto flex shrink-0 items-center gap-2">
						{Option.match(Option.fromUndefinedOr(props.palette), {
							onNone: () => null,
							onSome: () => <SearchIcon label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
						})}
						{props.controls}
						{props.account ?? <AccountMenu />}
					</div>
				</div>
				{secondLine && (
					<div
						className={cn(
							'flex items-center gap-6 border-t px-6 sm:h-8 sm:px-8',
							Boolean.match(props.tabs === undefined, {onFalse: () => 'h-11', onTrue: () => 'max-sm:hidden h-8'})
						)}
					>
						<nav aria-label="Sections" className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto">
							{props.tabs}
						</nav>
						{Option.match(Option.fromUndefinedOr(props.palette), {
							onNone: () => null,
							onSome: () => <SearchText label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
						})}
					</div>
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
