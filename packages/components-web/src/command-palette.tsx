import {Array, Boolean, Option, Record, String} from 'effect'

import {Dialog} from '@base-ui/react/dialog'
import {defaultFilter} from 'cmdk'
import {AppWindow, Search, X} from 'lucide-react'
import {useState, useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator
} from '#components/ui/command.tsx'
import {
	DialogClose,
	DialogDescription,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle
} from '#components/ui/dialog.tsx'
import {Kbd} from '#components/ui/kbd.tsx'

// The web tools the bar can jump to; the iOS apps have no browser screen to land on.
const APPS = [
	{name: 'deploy', url: 'https://deploy.mp281x.xyz'},
	{name: 'scope', url: 'https://scope.mp281x.xyz'},
	{name: 'gateway', url: 'https://gateway.mp281x.xyz'},
	{name: 'auth', url: 'https://auth.mp281x.xyz'},
	{name: 'signal', url: 'https://signal.mp281x.xyz'},
	{name: 'portfolio', url: 'https://mp281x.xyz'}
] as const

// `id` is the record's stable identity: cmdk selects by `value`, so it must not change when a label or detail updates.
export type PaletteItem = {
	detail?: string
	icon?: ReactNode
	id?: string
	keywords?: string
	label: string
	run: () => void
}

export type PaletteGroup = {items: readonly PaletteItem[]; label: string}

// Another web tool's own mark; a tool whose icon doesn't load falls back to a window rather than a broken image.
function AppIcon(props: {name: string; url: string}) {
	const [failed, setFailed] = useState(false)
	if (failed) return <AppWindow className="text-muted-foreground size-4" />
	return (
		<img
			src={`${props.url}/icon`}
			alt=""
			className="pixelated size-4"
			onError={() => setFailed(true)}
			title={props.name}
		/>
	)
}

function Item(props: {group: string; item: PaletteItem; onSelect: () => void}) {
	return (
		<CommandItem value={`${props.group}:${props.item.id ?? props.item.label}`} onSelect={props.onSelect}>
			{props.item.icon}
			<span className="min-w-0 shrink truncate">{props.item.label}</span>
			{props.item.detail !== undefined && (
				<span className="text-muted-foreground ml-auto max-w-1/2 truncate text-xs">{props.item.detail}</span>
			)}
		</CommandItem>
	)
}

// One search field over the page's records and actions, plus every other web tool; the bar opens it with ⌘K.
export function CommandPalette(props: {
	current?: string
	groups: readonly PaletteGroup[]
	onOpenChange: (open: boolean) => void
	open: boolean
}) {
	function run(item: PaletteItem) {
		props.onOpenChange(false)
		item.run()
	}
	const apps = Array.filter(APPS, app => app.name !== props.current)
	// cmdk keeps an item's first keywords, so the filter reads this render's text instead: stable value, current search.
	const searchable: Record<string, string> = Record.fromEntries([
		...Array.flatMap(props.groups, group =>
			Array.map(
				group.items,
				item =>
					[
						`${group.label}:${item.id ?? item.label}`,
						`${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`
					] as const
			)
		),
		...Array.map(apps, app => [`Deslop:${app.name}`, `${app.name} ${new URL(app.url).hostname}`] as const)
	])
	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<Dialog.Popup className="bg-popover text-popover-foreground ring-foreground/10 fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-dvh -translate-y-1/2 flex-col overflow-hidden rounded-lg ring-1 outline-none sm:max-w-lg">
					<DialogHeader className="sr-only">
						<DialogTitle>Search or run a command</DialogTitle>
						<DialogDescription>Jump to a record, run an action, or open another Deslop tool.</DialogDescription>
					</DialogHeader>
					<Command
						className="min-h-0"
						filter={(value, search) =>
							defaultFilter(
								Option.getOrElse(Record.get(searchable, value), () => value),
								search
							)
						}
					>
						<CommandInput placeholder={`Search ${props.current ?? 'Deslop'}…`} />
						<CommandList className="min-h-0">
							<CommandEmpty>No results.</CommandEmpty>
							{Array.map(
								Array.filter(props.groups, group => Array.isReadonlyArrayNonEmpty(group.items)),
								group => (
									<CommandGroup key={group.label} heading={group.label}>
										{Array.map(group.items, item => (
											<Item
												key={`${group.label}:${item.id ?? item.label}`}
												group={group.label}
												item={item}
												onSelect={() => run(item)}
											/>
										))}
									</CommandGroup>
								)
							)}
							<CommandSeparator />
							<CommandGroup heading="Other apps">
								{Array.map(apps, app => {
									const item = {
										detail: new URL(app.url).hostname,
										icon: <AppIcon name={app.name} url={app.url} />,
										keywords: new URL(app.url).hostname,
										label: app.name,
										run: () => {
											location.assign(app.url)
										}
									}
									return <Item key={app.name} group="Deslop" item={item} onSelect={() => run(item)} />
								})}
							</CommandGroup>
						</CommandList>
						<div className="text-muted-foreground hidden items-center justify-between border-t px-3 py-2 text-xs sm:flex">
							<span className="flex items-center gap-1">
								<Kbd>↑</Kbd>
								<Kbd>↓</Kbd>
								<span>navigate</span>
							</span>
							<span className="flex items-center gap-1">
								<Kbd>↵</Kbd>
								<span>open</span>
								<Kbd>esc</Kbd>
								<span>close</span>
							</span>
						</div>
					</Command>
					<DialogClose render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}>
						<X />
						<span className="sr-only">Close</span>
					</DialogClose>
				</Dialog.Popup>
			</DialogPortal>
		</Dialog.Root>
	)
}

// The bar's search, shaped like the input it stands in for; the mobile form is the search icon alone.
export function CommandTrigger(props: {label: string; onClick: () => void}) {
	// The handler takes Meta or Control, so the label and the announced shortcut name the key the reader actually has.
	const mac = useSyncExternalStore(
		() => () => {},
		() => Option.isSome(String.match(/Mac|iPhone|iPad/u)(navigator.userAgent)),
		() => true
	)
	return (
		<Button
			variant="outline"
			size="lg"
			aria-keyshortcuts={Boolean.match(mac, {onFalse: () => 'Control+K', onTrue: () => 'Meta+K'})}
			aria-label={props.label}
			onClick={props.onClick}
			className="hidden w-64 justify-start sm:flex lg:absolute lg:top-2 lg:left-1/2 lg:-translate-x-1/2"
		>
			<Search className="size-3.5" />
			<span className="min-w-0 flex-1 truncate text-left">Search</span>
			<span className="ml-auto">
				<Kbd>{Boolean.match(mac, {onFalse: () => 'Ctrl K', onTrue: () => '⌘K'})}</Kbd>
			</span>
		</Button>
	)
}

// The same field as an icon before the bar's actions on a phone.
export function CommandIcon(props: {label: string; onClick: () => void}) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={props.label}
			onClick={props.onClick}
			className="max-sm:size-11 sm:hidden"
		>
			<Search />
		</Button>
	)
}
