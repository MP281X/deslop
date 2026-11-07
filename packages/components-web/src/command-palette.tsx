import {Array, Boolean, Option, Record, String} from 'effect'

import {ArrowRightIcon, AppWindowIcon, MagnifyingGlassIcon} from '@phosphor-icons/react'
import {defaultFilter} from 'cmdk'
import {useState, useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut
} from '#components/ui/command.tsx'
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
	shortcut?: string
}

export type PaletteGroup = {items: readonly PaletteItem[]; label: string}

// Another web tool's own mark; a tool whose icon doesn't load falls back to a window rather than a broken image.
function AppIcon(props: {name: string; url: string}) {
	const [failed, setFailed] = useState(false)
	if (failed) return <AppWindowIcon className="text-muted-foreground size-4" />
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

export function otherApps(current: string) {
	return {
		items: Array.map(
			Array.filter(APPS, app => app.name !== current),
			app => ({
				detail: new URL(app.url).hostname,
				icon: <AppIcon name={app.name} url={app.url} />,
				label: app.name,
				run: () => location.assign(app.url)
			})
		),
		label: 'Other apps'
	}
}

// The detail trails the label in the muted tone, so a hostname or reason reads as part of the same entry.
function Item(props: {group: string; item: PaletteItem; onSelect: () => void}) {
	return (
		<CommandItem
			value={`${props.group}:${props.item.id ?? props.item.label}`}
			className="max-sm:h-11"
			onSelect={props.onSelect}
		>
			{props.item.icon ?? <ArrowRightIcon />}
			<span className="truncate">{props.item.label}</span>
			{props.item.detail !== undefined && (
				<span className="text-muted-foreground min-w-0 truncate">{props.item.detail}</span>
			)}
			{props.item.shortcut !== undefined && <CommandShortcut>{props.item.shortcut}</CommandShortcut>}
		</CommandItem>
	)
}

// One search field over the caller's records and actions; the bar opens it with ⌘K.
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
	// cmdk keeps an item's first keywords, so the filter reads this render's text instead: stable value, current search.
	const searchable: Record<string, string> = Record.fromEntries(
		Array.flatMap(props.groups, group =>
			Array.map(
				group.items,
				item =>
					[
						`${group.label}:${item.id ?? item.label}`,
						`${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`
					] as const
			)
		)
	)
	return (
		<CommandDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title="Search or run a command"
			description="Search available records and actions."
		>
			<Command
				filter={(value, search) =>
					defaultFilter(
						Option.getOrElse(Record.get(searchable, value), () => value),
						search
					)
				}
			>
				<CommandInput placeholder={`Search ${props.current ?? 'Deslop'}…`} />
				<CommandList>
					<CommandEmpty aria-label="No matches">
						<MagnifyingGlassIcon weight="light" className="text-muted-foreground mx-auto size-6" />
					</CommandEmpty>
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
				</CommandList>
			</Command>
		</CommandDialog>
	)
}

// A search field centred on the page from the small breakpoint up, its shortcut inside; on a phone, the same entry as an icon.
export function CommandTrigger(props: {label: string; onClick: () => void}) {
	// The handler takes Meta or Control, so the label and the announced shortcut name the key the reader actually has.
	const mac = useSyncExternalStore(
		() => () => {},
		() => Option.isSome(String.match(/Mac|iPhone|iPad/u)(navigator.userAgent)),
		() => true
	)
	const shortcut = {
		aria: Boolean.match(mac, {onFalse: () => 'Control+K', onTrue: () => 'Meta+K'}),
		label: Boolean.match(mac, {onFalse: () => 'Ctrl K', onTrue: () => '⌘K'})
	}
	return (
		<>
			<Button
				variant="outline"
				size="lg"
				aria-keyshortcuts={shortcut.aria}
				aria-label={props.label}
				onClick={props.onClick}
				className="absolute left-1/2 hidden w-72 -translate-x-1/2 sm:flex"
			>
				<MagnifyingGlassIcon />
				<span className="flex-1 text-left">Search</span>
				<Kbd>{shortcut.label}</Kbd>
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-keyshortcuts={shortcut.aria}
				aria-label={props.label}
				onClick={props.onClick}
				className="max-sm:size-11 sm:hidden"
			>
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}
