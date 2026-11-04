import {Array, Boolean, Option, Record} from 'effect'

import {defaultFilter} from 'cmdk'
import {Search} from 'lucide-react'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList
} from '#components/ui/command.tsx'
import {Kbd} from '#components/ui/kbd.tsx'

// The web tools the bar can jump to; the iOS apps have no browser screen to land on.
const APPS = [
	{abbr: 'DP', hue: '#4385be', name: 'deploy', url: 'https://deploy.mp281x.xyz'},
	{abbr: 'SC', hue: '#3aa99f', name: 'scope', url: 'https://scope.mp281x.xyz'},
	{abbr: 'GW', hue: '#8b7ec8', name: 'gateway', url: 'https://gateway.mp281x.xyz'},
	{abbr: 'AU', hue: '#da702c', name: 'auth', url: 'https://auth.mp281x.xyz'},
	{abbr: 'SG', hue: '#ce5d97', name: 'signal', url: 'https://signal.mp281x.xyz'},
	{abbr: 'PF', hue: '#da702c', name: 'portfolio', url: 'https://mp281x.xyz'}
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

// The app's own pixel mark, at the size a command row gives it.
function AppMark(props: {abbr: string; hue: string}) {
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 scale-75 items-center justify-center rounded-xs border border-(--mark-hue)/45 bg-(--mark-hue)/15 font-mono text-xs font-medium text-(--mark-hue)"
			style={{'--mark-hue': props.hue}}
		>
			{props.abbr}
		</span>
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
		...Array.map(APPS, app => [`Deslop:${app.name}`, `${app.name} ${app.abbr} ${new URL(app.url).hostname}`] as const)
	])
	return (
		<CommandDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title="Search or run a command"
			description="Jump to a record, run an action, or open another Deslop tool."
			showCloseButton
			className="sm:max-w-xl"
		>
			<Command
				filter={(value, search) =>
					defaultFilter(
						Option.getOrElse(Record.get(searchable, value), () => value),
						search
					)
				}
			>
				<CommandInput autoFocus placeholder="Search or run a command…" />
				<div className="flex min-h-0 flex-1 flex-col">
					<CommandList className="max-h-80">
						<CommandEmpty>No match.</CommandEmpty>
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
						<CommandGroup heading="Other apps">
							{Array.map(APPS, app => {
								const item = {
									detail: `${new URL(app.url).hostname}${Boolean.match(app.name === props.current, {
										onFalse: () => '',
										onTrue: () => ' · current'
									})}`,
									icon: <AppMark abbr={app.abbr} hue={app.hue} />,
									keywords: app.abbr,
									label: app.name,
									run: () => {
										location.assign(app.url)
									}
								}
								return <Item key={app.name} group="Deslop" item={item} onSelect={() => run(item)} />
							})}
						</CommandGroup>
					</CommandList>
				</div>
			</Command>
		</CommandDialog>
	)
}

// The bar's field, styled like an input but opening the palette; the mobile form is the search icon alone.
export function CommandTrigger(props: {label: string; onClick: () => void}) {
	return (
		<Button
			variant="search"
			aria-label={props.label}
			onClick={props.onClick}
			className="mx-auto hidden w-full max-w-sm justify-start sm:flex lg:absolute lg:left-1/2 lg:-translate-x-1/2"
		>
			<Search className="size-3.5" />
			<span className="min-w-0 flex-1 truncate text-left">Search or run a command</span>
			<Kbd className="ml-auto">⌘K</Kbd>
		</Button>
	)
}

// The same field as an icon before the bar's actions on a phone.
export function CommandIcon(props: {label: string; onClick: () => void}) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={props.label}
			onClick={props.onClick}
			className="ml-auto sm:hidden"
		>
			<Search />
		</Button>
	)
}
