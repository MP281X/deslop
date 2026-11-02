import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'

import {exposeAtom, exposeTargetAtom, inventoryAtom} from '#lib/utils.ts'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {InventoryItem} from '#services/inventory/schema.ts'

// Opens the Expose dialog on a port, with no answer left from an earlier one.
export function useExpose() {
	const setTarget = useAtomSet(exposeTargetAtom)
	const reset = useAtomSet(exposeAtom)
	return (port: InventoryItem) => {
		reset(Atom.Reset)
		setTarget(Option.some(port))
	}
}

// The port is chosen by its badge, so the dialog only asks who reaches it and, for the public, at which hostname.
function Expose(props: {items: readonly InventoryItem[]; port: InventoryItem}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<'tailnet' | 'public'>('tailnet')
	const [hostname, setHostname] = useState('')
	const tailnetHost = Option.getOrElse(
		Option.map(
			Array.findFirst(props.items, item => item.self === true && item.worker === props.port.worker),
			item => item.hostname ?? ''
		),
		() => ''
	)
	const pending = AsyncResult.isWaiting(result)
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={event => {
				event.preventDefault()
				expose({
					hostname: Boolean.match(kind === 'public', {onFalse: () => tailnetHost, onTrue: () => hostname}),
					kind,
					name: Boolean.match(kind === 'public', {
						onFalse: () => `tailnet:${props.port.port}`,
						onTrue: () => `public:${hostname}`
					}),
					port: props.port.port ?? 0,
					publicAccess: kind === 'public',
					target: Boolean.match(String.startsWith('remote:')(props.port.id), {
						onFalse: () => '',
						onTrue: () => props.port.worker
					})
				})
			}}
		>
			<DialogTitle className="flex items-center gap-2">
				<ApplicationIcon name={props.port.process ?? props.port.name} small />
				Expose {props.port.process}
				<Badge variant="outline" className="font-mono">
					:{props.port.port}
				</Badge>
			</DialogTitle>
			{/* Who reaches it, as tabs over the address: the tailnet's is fixed, a public one is typed. */}
			<Tabs
				value={kind}
				onValueChange={value => {
					if (value === 'public' || value === 'tailnet') setKind(value)
				}}
			>
				<TabsList className="w-full">
					<TabsTrigger value="tailnet" disabled={pending}>
						Tailnet
					</TabsTrigger>
					<TabsTrigger value="public" disabled={pending}>
						Public
					</TabsTrigger>
				</TabsList>
				<TabsContent value="tailnet">
					<Field>
						<FieldLabel htmlFor="expose-tailnet">Address</FieldLabel>
						<Input
							id="expose-tailnet"
							readOnly
							className="font-mono"
							value={Boolean.match(tailnetHost === '', {
								onFalse: () => `https://${tailnetHost}:${props.port.port}`,
								onTrue: () => ''
							})}
						/>
					</Field>
				</TabsContent>
				<TabsContent value="public">
					<Field>
						<FieldLabel htmlFor="expose-public">Hostname</FieldLabel>
						<Input
							id="expose-public"
							required={kind === 'public'}
							className="font-mono"
							placeholder="app.example.com"
							autoCapitalize="none"
							spellCheck={false}
							value={hostname}
							disabled={pending}
							onChange={event => setHostname(String.toLowerCase(event.target.value))}
						/>
					</Field>
				</TabsContent>
			</Tabs>
			<ResultError result={result} />
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>Cancel</DialogClose>
				<Button
					type="submit"
					disabled={pending || (kind === 'tailnet' && tailnetHost === '') || (kind === 'public' && hostname === '')}
				>
					{Boolean.match(pending, {onFalse: () => 'Expose', onTrue: () => 'Exposing…'})}
				</Button>
			</DialogFooter>
		</form>
	)
}

// Open while a port is chosen; it closes on success, the new endpoint replacing the port's badge.
export function ExposeDialog() {
	const [target, setTarget] = useAtom(exposeTargetAtom)
	return Option.match(Option.all({port: target, snapshot: AsyncResult.value(useAtomValue(inventoryAtom))}), {
		onNone: () => null,
		onSome: open => (
			<Dialog
				open
				onOpenChange={next => {
					if (!next) setTarget(Option.none())
				}}
			>
				<DialogContent>
					<Expose key={open.port.id} items={open.snapshot.items} port={open.port} />
				</DialogContent>
			</Dialog>
		)
	})
}
