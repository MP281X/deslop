import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Effect, Equal, Function, Option, Predicate, Schema, String, Struct, pipe} from 'effect'

import {ArrowClockwiseIcon, CaretLeftIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import type {ComponentProps, KeyboardEvent, ReactElement, ReactNode} from 'react'

import {avatarUrlOf} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {accountAtom} from '@deslop/runtime/web/client'

import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button} from '#components/ui/button.tsx'
import {Skeleton} from '#components/ui/skeleton.tsx'
import {Tabs, TabsList, TabsTrigger} from '#components/ui/tabs.tsx'

// The menu's floating-ui bundle is the page's heaviest import, so it arrives on intent rather than with the bar.
const menuModuleAtom = Atom.keepAlive(Atom.fn(() => Effect.promise(() => import('#components/ui/dropdown-menu.tsx'))))

export type AvatarAccount = typeof AvatarAccount.Type
const AvatarAccount = Schema.Struct(Struct.pick(Account.fields, ['id', 'name']))

// A GitHub account's picture, or its first letter until the picture loads: small in the bar's button, the registry's default in a row.
export function AccountAvatar(props: {account: AvatarAccount; size: ComponentProps<typeof Avatar>['size']}) {
	return (
		<Avatar size={props.size ?? 'default'}>
			<AvatarImage src={Option.getOrUndefined(avatarUrlOf(props.account.id))} alt={props.account.name} />
			<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(props.account.name))}</AvatarFallback>
		</Avatar>
	)
}

// The bar's account control, also the trigger a menu renders as: the avatar in a ghost icon button.
export function AccountButton(props: ComponentProps<typeof Button> & {account: AvatarAccount}) {
	return (
		<Button {...Struct.omit(props, ['account'])} variant="ghost" size="icon-sm" aria-label="Account">
			<AccountAvatar account={props.account} size="sm" />
		</Button>
	)
}

// Signing out goes through Auth, which ends the session every app shares; a tailnet caller has no session to end, so no sign-out.
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
	if (AsyncResult.isFailure(loaded)) {
		return (
			<Button variant="destructive" size="sm" aria-label="Account menu unavailable. Try again" onClick={activate}>
				<ArrowClockwiseIcon />
				Retry account menu
			</Button>
		)
	}
	if (!AsyncResult.isSuccess(loaded) || open === undefined) {
		return (
			<AccountButton
				account={account.value}
				aria-haspopup="menu"
				aria-expanded={open ?? false}
				onPointerEnter={load}
				onPointerDown={load}
				onFocus={load}
				onClick={activate}
				onKeyDown={activateWithKey}
			/>
		)
	}
	return (
		<loaded.value.DropdownMenu open={open} onOpenChange={setOpen}>
			<loaded.value.DropdownMenuTrigger render={<AccountButton account={account.value} />} />
			<loaded.value.DropdownMenuContent align="end" className="w-56">
				<loaded.value.DropdownMenuGroup>
					<loaded.value.DropdownMenuLabel>@{account.value.name}</loaded.value.DropdownMenuLabel>
				</loaded.value.DropdownMenuGroup>
				{account.value.signOut && (
					<>
						<loaded.value.DropdownMenuSeparator />
						<form action={`/auth/sign-out?${new URLSearchParams({next: location.href})}`} method="post">
							<loaded.value.DropdownMenuItem
								variant="destructive"
								render={<button aria-label="Sign out" type="submit" />}
							>
								Sign out
							</loaded.value.DropdownMenuItem>
						</form>
					</>
				)}
			</loaded.value.DropdownMenuContent>
		</loaded.value.DropdownMenu>
	)
}

// Tabs, their marks and the bar's controls can arrive after the bar, so each change to the tabs and each resize of them or of the bar's scrolling strip places the chosen one again; one already in view stays put.
function keepChosenTabInView(sections: HTMLDivElement) {
	const strip = sections.parentElement
	if (Predicate.isNullish(strip)) return
	function place(scroller: HTMLElement) {
		const active = sections.querySelector<HTMLElement>('[data-active]')
		if (Predicate.isNullish(active)) return
		const tab = active.getBoundingClientRect()
		const bounds = scroller.getBoundingClientRect()
		if (tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1) return
		active.scrollIntoView({block: 'nearest', inline: 'nearest'})
	}
	const changes = new MutationObserver(() => place(strip))
	changes.observe(sections, {attributeFilter: ['data-active'], childList: true, subtree: true})
	// A resize observer reports each element once on observing, which places the tab the first time.
	const resizes = new ResizeObserver(() => place(strip))
	resizes.observe(strip)
	resizes.observe(sections)
	return () => {
		changes.disconnect()
		resizes.disconnect()
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

// The strip before its tabs arrive: the real list holding tab-sized blocks (a tab is its 16px mark, 6px padding and 1px border either side), so the bar keeps its size when they come.
export function AppBarTabsSkeleton(props: {count: number}) {
	return (
		<div aria-hidden>
			<Tabs value="">
				<TabsList>
					{Array.makeBy(props.count, index => (
						<Skeleton key={index} className="h-full w-7.5" />
					))}
				</TabsList>
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
				Option.getOrElse(Function.constant(''))
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
					<Button
						variant="ghost"
						nativeButton={false}
						render={<a href="/" aria-label={props.name} />}
						className="shrink-0"
					>
						<img src={props.icon} alt="" className="pixelated size-6" />
						<span className="font-heading text-sm font-semibold capitalize max-sm:hidden">{props.name}</span>
					</Button>
				),
				onSome: heading => (
					<div className="flex min-w-0 shrink items-center gap-1">
						<Button variant="ghost" size="icon-sm" aria-label={heading.back.label} onClick={heading.back.onClick}>
							<CaretLeftIcon />
						</Button>
						<span className="font-heading max-w-48 min-w-0 truncate text-sm">{heading.title}</span>
					</div>
				)
			})}
			{props.tabs !== undefined && (
				<nav
					aria-label="Sections"
					className="flex min-w-0 flex-1 scrollbar-none items-center overflow-x-auto overflow-y-hidden overscroll-x-contain"
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
