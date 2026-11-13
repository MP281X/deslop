import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Effect, Equal, Option, Predicate, String, pipe} from 'effect'

import {CaretLeftIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import type {KeyboardEvent, ReactElement, ReactNode} from 'react'

import type {Account} from '@deslop/runtime/shared/schema'
import {accountAtom} from '@deslop/runtime/web/client'

import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button} from '#components/ui/button.tsx'
import {Tabs, TabsList, TabsTrigger} from '#components/ui/tabs.tsx'
import {cn} from '#lib/classes.ts'

// The menu's floating-ui bundle is the page's heaviest import, so it arrives on intent rather than with the bar.
const menuModuleAtom = Atom.keepAlive(Atom.fn(() => Effect.promise(() => import('#components/ui/dropdown-menu.tsx'))))

// A GitHub account's picture, or its first letter until the picture loads: 24px in the bar, 16px in a row.
export function AccountAvatar(props: {account: Pick<Account, 'id' | 'name'>; small?: boolean}) {
	return (
		<Avatar
			size={Boolean.match(props.small === true, {onFalse: () => 'sm' as const, onTrue: () => 'default' as const})}
			variant="plain"
			className={cn(props.small === true && 'size-4')}
		>
			<AvatarImage
				src={`https://avatars.githubusercontent.com/u/${String.replace('github:', '')(props.account.id)}?s=96`}
				alt={props.account.name}
			/>
			<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(props.account.name))}</AvatarFallback>
		</Avatar>
	)
}

// Signing out goes through Auth, which ends the session every app shares.
function AccountMenu() {
	const account = useAtomValue(accountAtom)
	const [loaded, loadMenu] = useAtom(menuModuleAtom)
	const [open, setOpen] = useState<boolean>()

	function load() {
		loadMenu()
	}

	function activate() {
		setOpen(true)
		loadMenu()
	}

	function activateWithKey(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
		event.preventDefault()
		activate()
	}

	if (!AsyncResult.isSuccess(account)) return null
	if (!AsyncResult.isSuccess(loaded) || open === undefined) {
		return (
			<Button
				variant="ghost"
				size="icon-sm"
				className="max-sm:size-11"
				aria-label="Account"
				aria-haspopup="menu"
				aria-expanded={open ?? false}
				onPointerEnter={load}
				onPointerDown={load}
				onFocus={load}
				onClick={activate}
				onKeyDown={activateWithKey}
			>
				<AccountAvatar account={account.value} />
			</Button>
		)
	}
	return (
		<loaded.value.DropdownMenu open={open} onOpenChange={setOpen}>
			<loaded.value.DropdownMenuTrigger
				aria-label="Account"
				render={<Button variant="ghost" size="icon-sm" className="max-sm:size-11" />}
			>
				<AccountAvatar account={account.value} />
			</loaded.value.DropdownMenuTrigger>
			<loaded.value.DropdownMenuContent align="end" className="w-auto min-w-48">
				<loaded.value.DropdownMenuGroup>
					<loaded.value.DropdownMenuLabel>@{account.value.name}</loaded.value.DropdownMenuLabel>
				</loaded.value.DropdownMenuGroup>
				<loaded.value.DropdownMenuSeparator />
				<loaded.value.DropdownMenuItem
					variant="destructive"
					className="max-sm:h-11"
					disabled={!account.value.signOut}
					render={<a aria-label="Sign out" href={`/auth/sign-out?${new URLSearchParams({next: location.href})}`} />}
				>
					Sign out
				</loaded.value.DropdownMenuItem>
			</loaded.value.DropdownMenuContent>
		</loaded.value.DropdownMenu>
	)
}

// Tabs can arrive after the bar, so each change to them places the chosen one again; one already in view stays put.
function keepChosenTabInView(sections: HTMLDivElement) {
	function place() {
		const active = sections.querySelector<HTMLElement>('[data-active]')
		if (Predicate.isNullish(active) || Predicate.isNullish(sections.parentElement)) return
		const tab = active.getBoundingClientRect()
		const bounds = sections.parentElement.getBoundingClientRect()
		if (tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1) return
		active.scrollIntoView({block: 'nearest', inline: 'nearest'})
	}
	place()
	const changes = new MutationObserver(place)
	changes.observe(sections, {attributeFilter: ['data-active'], childList: true, subtree: true})
	return () => {
		changes.disconnect()
	}
}

// The app's sections as one segmented control in the masthead; `value` names the current one. A bar narrow enough to need it scrolls this control sideways, keeping the chosen tab in view.
export function AppBarTabs(props: {children: ReactNode; value: string}) {
	return (
		<div ref={keepChosenTabInView}>
			<Tabs value={props.value}>
				<TabsList>{props.children}</TabsList>
			</Tabs>
		</div>
	)
}

// A section the current URL can name: the tab navigates through a router link.
export function AppBarTab(props: {children: ReactNode; render: ReactElement; value: string}) {
	return (
		<TabsTrigger value={props.value} nativeButton={false} render={props.render}>
			{props.children}
		</TabsTrigger>
	)
}

// A bar's segmented choice: the stock tabs over one list of options, named for assistive technology. Each tab is keyed by its label, so a choice hands back its option's own value.
export function AppBarChoice<A>(props: {
	label: string
	onChange: (value: A) => void
	options: readonly {label: string; value: A}[]
	value: A
}) {
	return (
		<Tabs
			value={pipe(
				props.options,
				Array.findFirst(option => Equal.equals(option.value, props.value)),
				Option.map(option => option.label),
				Option.getOrElse(() => '')
			)}
			onValueChange={label =>
				pipe(
					props.options,
					Array.findFirst(option => option.label === label),
					Option.map(option => props.onChange(option.value))
				)
			}
		>
			<TabsList aria-label={props.label}>
				{Array.map(props.options, option => (
					<TabsTrigger key={option.label} value={option.label}>
						{option.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}

// The masthead: mark and name, sections, then the controls that choose what the page shows and the page's few actions.
export function AppBar(props: {
	account?: ReactNode
	controls?: ReactNode
	heading?: {back: {label: string; onClick: () => void}; title: string}
	icon: string
	name: string
	tabs?: ReactNode
}) {
	return (
		<header className="bg-background flex h-12 shrink-0 items-center gap-4 border-b px-4">
			{Option.match(Option.fromUndefinedOr(props.heading), {
				onNone: () => (
					<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-2.5 max-sm:h-11">
						<img src={props.icon} alt="" className="pixelated size-6" />
						<span className="font-heading text-sm font-semibold capitalize max-sm:hidden">{props.name}</span>
					</a>
				),
				// The back caret sits on the rows' 16px mark column and the title on their name column, at 44px.
				onSome: heading => (
					<div className="flex min-w-0 shrink items-center gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							className="-ml-2 max-sm:-mr-1.5 max-sm:-ml-3.5 max-sm:size-11"
							aria-label={heading.back.label}
							onClick={heading.back.onClick}
						>
							<CaretLeftIcon className="size-4" />
						</Button>
						<span className="font-heading max-w-48 min-w-0 truncate text-sm font-semibold">{heading.title}</span>
					</div>
				)
			})}
			{props.tabs !== undefined && (
				<nav
					aria-label="Sections"
					className="flex min-w-0 flex-1 scrollbar-none items-center overflow-x-auto overscroll-x-contain"
				>
					{props.tabs}
				</nav>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-2">
				{props.controls}
				{props.account ?? <AccountMenu />}
			</div>
		</header>
	)
}
