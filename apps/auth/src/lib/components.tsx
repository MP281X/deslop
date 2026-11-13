import {useAtom} from '@effect/atom-react'

import {Array, Boolean, DateTime, Option, Order, Record, String, Struct, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import type {ComponentType, SVGProps} from 'react'

import {cn} from '@deslop/components-web/classes'
import {EmptyState, Loaded} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {ThemedMark} from '@deslop/components-web/marks'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {AndroidIcon} from '@deslop/components-web/ui/svgs/androidIcon'
import {Apple} from '@deslop/components-web/ui/svgs/apple'
import {AppleDark} from '@deslop/components-web/ui/svgs/appleDark'
import {Chrome} from '@deslop/components-web/ui/svgs/chrome'
import {ClaudeAiIcon} from '@deslop/components-web/ui/svgs/claudeAiIcon'
import {CodexDark} from '@deslop/components-web/ui/svgs/codexDark'
import {CodexLight} from '@deslop/components-web/ui/svgs/codexLight'
import {Edge} from '@deslop/components-web/ui/svgs/edge'
import {Firefox} from '@deslop/components-web/ui/svgs/firefox'
import {Safari} from '@deslop/components-web/ui/svgs/safari'
import {ageOf} from '@deslop/runtime/shared/format'

import {appsAtom, consentAtom, minuteAtom, requestCode} from '#lib/auth.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

// A glyph until the app's own icon loads, so a missing icon never draws the browser's broken image; no tile behind either.
function AppIcon(props: {origin: string}) {
	const [state, setState] = useState<'failed' | 'loaded' | 'loading'>('loading')
	return (
		<span className="text-muted-foreground relative flex size-4 shrink-0 items-center justify-center">
			{state !== 'loaded' && <AppWindowIcon className="size-4" />}
			{state !== 'failed' && (
				<img
					src={`${props.origin}/icon`}
					alt=""
					className={cn('pixelated absolute inset-0 size-full', state === 'loading' && 'invisible')}
					onLoad={() => setState('loaded')}
					onError={() => setState('failed')}
				/>
			)}
		</span>
	)
}

// The row whose code lookup is running, where the found sign-in will sit.
function PendingRowSkeleton() {
	return (
		<div className="bg-primary/10">
			<Item aria-hidden size="row">
				<ItemMedia className="size-4">
					<Skeleton className="size-4" />
				</ItemMedia>
				<ItemContent>
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-3 w-16" />
				</ItemContent>
				<ItemActions>
					<Skeleton className="h-6 w-14" />
					<Skeleton className="h-6 w-16" />
				</ItemActions>
			</Item>
		</div>
	)
}

// The signed-in rows a card will hold while its data loads, at the loaded rows' geometry: 16px mark at the gutter, name at 44px, figures right-aligned.
export function SignInRowsSkeleton(props: {pending?: boolean}) {
	return (
		<Card size="list">
			{props.pending === true && <PendingRowSkeleton />}
			<RowsSkeleton label="Signed in" rows={9}>
				<ItemMedia className="size-4">
					<Skeleton className="size-4" />
				</ItemMedia>
				<ItemContent>
					<Skeleton className="h-3 w-2/5" />
				</ItemContent>
				<ItemActions>
					<Skeleton className="h-3 w-12 shrink-0" />
					<Skeleton className="h-3 w-28 shrink-0 max-sm:hidden" />
				</ItemActions>
			</RowsSkeleton>
		</Card>
	)
}

// The people rows a card will hold while the list loads, with the mark, name, handle and since date.
export function PeopleRowsSkeleton() {
	return (
		<Card size="list">
			<RowsSkeleton label="People" rows={3}>
				<ItemMedia className="size-4">
					<Skeleton className="size-4" />
				</ItemMedia>
				<ItemContent>
					<Skeleton className="h-3 w-2/5" />
					<Skeleton className="h-3 w-16" />
				</ItemContent>
				<ItemActions>
					<Skeleton className="h-3 w-16 shrink-0" />
				</ItemActions>
			</RowsSkeleton>
		</Card>
	)
}

const BROWSERS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {Chrome, Edge, Firefox, Safari}

type Client = {app: Option.Option<string>; device: string; kind: 'App' | 'Browser'; name: string}

function Brand(props: {client: Client}) {
	if (props.client.kind === 'Browser') {
		return pipe(
			BROWSERS,
			Record.get(props.client.name),
			Option.match({onNone: () => <GlobeIcon />, onSome: Mark => <Mark aria-hidden className="size-3.5" />})
		)
	}
	if (Option.isSome(String.match(/claude/iu)(props.client.name))) {
		return <ClaudeAiIcon aria-hidden className="size-3.5" />
	}
	if (Option.isSome(String.match(/codex/iu)(props.client.name))) {
		return <ThemedMark light={CodexLight} dark={CodexDark} className="size-3.5" />
	}
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(props.client.name))) return <GraphIcon />
	if (Array.contains(['iPhone', 'iPad'], props.client.device)) {
		return <ThemedMark light={Apple} dark={AppleDark} className="size-3.5" />
	}
	if (props.client.device === 'Android') return <AndroidIcon aria-hidden className="size-3.5" />
	return <HardDrivesIcon />
}

function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => <Brand client={props.client} />,
		onSome: origin => <AppIcon origin={origin} />
	})
}

function ClientRow(props: {client: SignedInApp; now: DateTime.Utc}) {
	const active = ageOf(props.client.lastActive, props.now)
	const address = Option.filter(props.client.address, value => value !== props.client.device)
	return (
		<div role="listitem">
			<Item
				size="row"
				aria-label={`${props.client.device}, active ${active}${Option.match(address, {
					onNone: () => '',
					onSome: value => ` · ${value}`
				})}`}
			>
				{/* The browser or app is the mark alone, so every row's name starts at the same column. */}
				<ItemMedia className="size-4" role="img" aria-label={props.client.client} title={props.client.client}>
					<ClientIcon
						client={{
							app: props.client.icon,
							device: props.client.device,
							kind: props.client.kind,
							name: props.client.client
						}}
					/>
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.client.device}</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{active}</span>
					<span className="text-muted-foreground w-28 shrink-0 truncate text-right font-mono text-xs max-sm:hidden">
						{Option.getOrElse(address, () => '')}
					</span>
				</ItemActions>
			</Item>
		</div>
	)
}

// A waiting sign-in leads the card, tinted, its code under the label; its answer stays on the row.
function PendingRow(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<div role="listitem" className="bg-primary/10">
			<Item size="row">
				<ItemMedia className="size-4" role="img" aria-label={props.request.clientName} title={props.request.clientName}>
					{Option.match(props.request.icon, {
						onNone: () =>
							Boolean.match(props.request.kind === 'Browser', {
								onFalse: () => <HardDrivesIcon />,
								onTrue: () => <GlobeIcon />
							}),
						onSome: origin => <AppIcon origin={origin} />
					})}
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.request.device}</ItemTitle>
					<ItemDescription>{requestCode(props.request.id)}</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button
						variant="outline"
						size="xs"
						disabled={waiting}
						aria-label={`Deny ${props.request.device}`}
						onClick={() => respond({accept: false, request: props.request})}
					>
						Deny
					</Button>
					<Button
						size="xs"
						disabled={waiting}
						aria-label={`Approve ${props.request.device}`}
						onClick={() => respond({accept: true, request: props.request})}
					>
						Approve
					</Button>
				</ItemActions>
			</Item>
			<ResultError result={consent} className="mb-2 ml-9" />
		</div>
	)
}

function newest(apps: readonly [SignedInApp, ...SignedInApp[]]) {
	return Array.reduce(apps, apps[0].lastActive, (latest, app) => DateTime.max(latest, app.lastActive))
}

function clientsOf(signIns: readonly SignedInApp[]) {
	return pipe(
		Array.groupBy(signIns, signIn => `${signIn.client} · ${signIn.device}`),
		Record.values,
		Array.filter(Array.isReadonlyArrayNonEmpty),
		Array.sort(Order.flip(Order.mapInput(DateTime.Order, newest))),
		Array.map(group => {
			const lastActive = newest(group)
			return {
				...Struct.pick(group[0], ['client', 'device', 'family', 'icon', 'kind', 'parent']),
				address: pipe(
					group,
					Array.findFirst(signIn => DateTime.Equivalence(signIn.lastActive, lastActive)),
					Option.flatMap(signIn => signIn.address)
				),
				lastActive
			}
		})
	)
}

// A retry restarts the live sign-ins reader.
const signInListAtom = Atom.readable(
	get => AsyncResult.all({now: get(minuteAtom), signIns: get(appsAtom)}),
	refresh => {
		refresh(appsAtom)
	}
)

export function SignInList(props: {checking?: boolean; pending: Option.Option<PendingAuthorization>}) {
	return (
		<Loaded atom={signInListAtom}>
			{data => {
				const clients = clientsOf(data.signIns)
				const checking = props.checking === true && Option.isNone(props.pending)
				if (Array.isReadonlyArrayEmpty(clients) && Option.isNone(props.pending) && !checking) {
					return <EmptyState label="No sign-ins" icon={<HardDrivesIcon className="size-5" weight="light" />} />
				}
				return (
					<Card size="list">
						<div role="list" aria-label="Signed-in clients">
							{Boolean.match(checking, {
								onFalse: () =>
									Option.match(props.pending, {
										onNone: () => null,
										onSome: request => <PendingRow request={request} />
									}),
								onTrue: () => (
									<div role="status" aria-label="Checking the code">
										<PendingRowSkeleton />
									</div>
								)
							})}
							{Array.map(clients, client => (
								<ClientRow key={client.family} client={client} now={data.now} />
							))}
						</div>
					</Card>
				)
			}}
		</Loaded>
	)
}
