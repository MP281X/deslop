import {Array, Option, Record} from 'effect'

import {ArrowRightIcon, MagnifyingGlassIcon} from '@phosphor-icons/react'
import {defaultFilter} from 'cmdk'
import type {ReactNode} from 'react'

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

// The detail trails the label in the muted tone, so a hostname or reason reads as part of the same entry.
function Item(props: {group: string; item: PaletteItem; onSelect: () => void}) {
	return (
		<CommandItem
			value={`${props.group}:${props.item.id ?? props.item.label}`}
			className="max-sm:min-h-11"
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
				<CommandList className="sm:max-h-96">
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
