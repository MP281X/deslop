import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {useSearch} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Plus} from 'lucide-react'
import {useState} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList
} from '@deslop/components-web/ui/combobox'
import {Dialog, DialogContent, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Input} from '@deslop/components-web/ui/input'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {MachineIcon} from '#lib/components.tsx'
import {exposeAtom, exposeOpenAtom, inventoryAtom} from '#lib/utils.ts'
import {availablePorts, portLabel} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'

function Expose(props: {items: readonly InventoryItem[]; choices: readonly InventoryItem[]}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<'tailnet' | 'public'>('tailnet')
	const [selectedId, setSelectedId] = useState('')
	const [hostname, setHostname] = useState('')
	const selectedItem = Option.getOrUndefined(Array.findFirst(props.choices, item => item.id === selectedId))
	const tailnetHost = Option.getOrElse(
		Option.map(
			Array.findFirst(props.items, item => item.self === true && item.worker === selectedItem?.worker),
			item => item.hostname ?? ''
		),
		() => ''
	)
	const pending = AsyncResult.isWaiting(result)
	return (
		<form
			aria-label="Expose a port"
			className="flex flex-col gap-3"
			onSubmit={event => {
				event.preventDefault()
				if (selectedItem?.port === undefined) return
				expose({
					hostname: Boolean.match(kind === 'public', {onFalse: () => tailnetHost, onTrue: () => hostname}),
					kind,
					name: Boolean.match(kind === 'public', {
						onFalse: () => `tailnet:${selectedItem.port}`,
						onTrue: () => `public:${hostname}`
					}),
					port: selectedItem.port,
					publicAccess: kind === 'public',
					target: Boolean.match(String.startsWith('remote:')(selectedItem.id), {
						onFalse: () => '',
						onTrue: () => selectedItem.worker
					})
				})
			}}
		>
			<DialogTitle>Expose a port</DialogTitle>
			<ToggleGroup
				aria-label="Exposure visibility"
				value={[kind]}
				disabled={pending}
				onValueChange={values => {
					if (values[0] === 'public' || values[0] === 'tailnet') setKind(values[0])
				}}
			>
				<ToggleGroupItem value="tailnet">Tailnet</ToggleGroupItem>
				<ToggleGroupItem value="public">Public</ToggleGroupItem>
			</ToggleGroup>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<Combobox
						items={props.choices}
						value={selectedItem ?? null}
						itemToStringLabel={portLabel}
						isItemEqualToValue={(a, b) => a.id === b.id}
						onValueChange={item => setSelectedId(item?.id ?? '')}
						disabled={pending}
					>
						<ComboboxInput
							id="expose-port"
							aria-label="Listening port"
							placeholder="Choose an app…"
							className="w-full"
							showClear
						/>
						<ComboboxContent className="w-(--available-width) max-w-sm sm:w-(--anchor-width)">
							<ComboboxEmpty>No matching app listeners.</ComboboxEmpty>
							<ComboboxList>
								{(item: InventoryItem) => (
									<ComboboxItem key={item.id} value={item} className="pr-7">
										<MachineIcon worker={item.worker} />
										<span className="min-w-0 flex-1 truncate" title={item.unit || item.process}>
											{item.process}
										</span>
										<Badge variant="secondary" className="font-mono">
											:{item.port}
										</Badge>
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</div>
				{kind === 'public' && (
					<div className="min-w-0 flex-1">
						<Input
							id="expose-hostname"
							aria-label="Public hostname"
							required
							placeholder="app.example.com"
							autoCapitalize="none"
							spellCheck={false}
							value={hostname}
							disabled={pending}
							onChange={event => setHostname(String.toLowerCase(event.target.value))}
						/>
					</div>
				)}
				<Button
					type="submit"
					size="icon"
					aria-label="Expose port"
					disabled={
						pending ||
						selectedItem === undefined ||
						(kind === 'tailnet' && tailnetHost === '') ||
						(kind === 'public' && hostname === '')
					}
				>
					{Boolean.match(pending, {onFalse: () => <Plus />, onTrue: () => <Spinner />})}
				</Button>
			</div>
			{selectedId !== '' && selectedItem === undefined && (
				<p className="text-warning text-xs" role="status">
					The selected listener is no longer available. Pick another port.
				</p>
			)}
			<ResultError result={result} />
		</form>
	)
}

// Opened from the app bar once the inventory has loaded; it closes on success, the new endpoint showing on its app's row.
export function ExposeDialog() {
	const [open, setOpen] = useAtom(exposeOpenAtom)
	const search = useSearch({from: '/(home)'})
	return Option.match(AsyncResult.value(useAtomValue(inventoryAtom)), {
		onNone: () => null,
		onSome: snapshot => {
			const items = Array.filter(
				snapshot.items,
				item => search.machine === undefined || search.machine === 'all' || item.worker === search.machine
			)
			return (
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogContent>
						<Expose key={search.machine ?? 'all'} items={items} choices={availablePorts(items)} />
					</DialogContent>
				</Dialog>
			)
		}
	})
}
