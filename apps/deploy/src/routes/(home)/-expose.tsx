import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Option, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'

import {exposeAtom, exposeTargetAtom, inventoryAtom} from '#lib/fleet.ts'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {ExposureName} from '#services/inventory/schema.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'

type ExposureKind = typeof ExposureKind.Type
const ExposureKind = Schema.Literals(['tailnet', 'public'])

function Expose(props: {items: readonly InventoryItem[]; port: InventoryItem}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<ExposureKind>('tailnet')
	const [hostname, setHostname] = useState('')
	const tailnetHost = Option.getOrElse(
		pipe(
			props.items,
			Array.findFirst(item => Option.contains(item.self, true) && item.worker === props.port.worker),
			Option.flatMap(item => item.hostname)
		),
		Function.constant('')
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
					name: ExposureName.make(
						Boolean.match(kind === 'public', {
							onFalse: () => `tailnet:${Option.getOrThrow(props.port.port)}`,
							onTrue: () => `public:${hostname}`
						})
					),
					port: Option.getOrThrow(props.port.port),
					publicAccess: kind === 'public',
					worker: props.port.worker
				})
			}}
		>
			<DialogHeader>
				<div className="flex min-w-0 items-center gap-2">
					<ApplicationIcon name={Option.getOrElse(props.port.process, () => props.port.name)} small />
					<DialogTitle>{Option.getOrElse(props.port.process, () => props.port.name)}</DialogTitle>
					<Badge variant="outline">:{Option.getOrUndefined(props.port.port)}</Badge>
				</div>
			</DialogHeader>
			{/* Who reaches it, as tabs over the address: the tailnet's is fixed, a public one is typed. */}
			<Tabs
				value={kind}
				onValueChange={(value: string) => {
					if (Schema.is(ExposureKind)(value)) setKind(value)
				}}
			>
				<TabsList className="w-full">
					{Array.map(ExposureKind.literals, value => (
						<TabsTrigger key={value} value={value} disabled={pending}>
							{String.capitalize(value)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="tailnet">
					<Field>
						<FieldLabel htmlFor="expose-tailnet">Address</FieldLabel>
						<Input
							id="expose-tailnet"
							readOnly
							value={Boolean.match(tailnetHost === '', {
								onFalse: () => `https://${tailnetHost}:${Option.getOrUndefined(props.port.port)}`,
								onTrue: Function.constant('')
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
					{Boolean.match(pending, {onFalse: Function.constant('Expose'), onTrue: Function.constant('Exposing…')})}
				</Button>
			</DialogFooter>
		</form>
	)
}

export function ExposeDialog() {
	const [target, setTarget] = useAtom(exposeTargetAtom)
	return Option.match(Option.all({port: target, snapshot: AsyncResult.value(useAtomValue(inventoryAtom))}), {
		onNone: Function.constNull,
		onSome: open => (
			<Dialog
				open
				onOpenChange={next => {
					if (!next) setTarget(Option.none())
				}}
			>
				{/* Cancel already closes it, so the corner X would be the same action twice. */}
				<DialogContent showCloseButton={false}>
					<Expose key={open.port.id} items={open.snapshot.items} port={open.port} />
				</DialogContent>
			</Dialog>
		)
	})
}
