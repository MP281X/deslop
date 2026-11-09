import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, Order, Record, String, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import {toQR} from 'toqr'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn} from '@deslop/components-web/utils'

import android from '#lib/brands/android.svg'
import apple from '#lib/brands/apple.svg'
import chrome from '#lib/brands/chrome.svg'
import claude from '#lib/brands/claude.svg'
import codex from '#lib/brands/codex.svg'
import edge from '#lib/brands/edge.svg'
import firefox from '#lib/brands/firefox.svg'
import safari from '#lib/brands/safari.svg'
import {
	ageLabel,
	appsAtom,
	avatarUrl,
	catalogAtom,
	consentAtom,
	minuteAtom,
	minutesSince,
	newest,
	requestCode,
	selectedRowAtom,
	signInLabel
} from '#lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import {withChildActivity} from '#services/tokens/lib/utils.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

// The link as a QR code, one square per dark module, inside the quiet zone scanners need.
export function QrCode(props: {className?: string; text: string}) {
	const modules = Array.fromIterable(toQR(props.text))
	const size = Math.sqrt(modules.length)
	return (
		<svg
			viewBox={`-2 -2 ${size + 4} ${size + 4}`}
			shapeRendering="crispEdges"
			fill="currentColor"
			className={props.className}
			aria-hidden="true"
		>
			<path
				d={pipe(
					modules,
					Array.map((dark, index) => ({dark, x: index % size, y: Math.floor(index / size)})),
					Array.filter(module => module.dark === 1),
					Array.map(module => `M${module.x} ${module.y}h1v1h-1z`),
					Array.join('')
				)}
			/>
		</svg>
	)
}

// A GitHub account's picture, or its first letter until the picture loads; a row's picture sits at 16px.
export function AccountAvatar(props: {id: string; name: string; small?: boolean}) {
	return (
		<Avatar
			size={Boolean.match(props.small === true, {onFalse: () => 'sm', onTrue: () => 'default'})}
			className={cn(props.small === true && 'size-4')}
		>
			<AvatarImage src={avatarUrl(props.id)} alt={props.name} />
			<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(props.name))}</AvatarFallback>
		</Avatar>
	)
}

// A glyph until the app's own icon loads, so a missing icon never draws the browser's broken image; no tile behind either.
export function AppIcon(props: {origin: string}) {
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

function ClientRowSkeleton() {
	return (
		<Item aria-hidden size="row">
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
		</Item>
	)
}

// The row whose code lookup is running, where the found sign-in will sit.
function PendingRowSkeleton() {
	return (
		<div role="listitem" className="bg-primary/10">
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
			<div aria-busy="true" aria-label="Signed in" role="status">
				<div role="list" aria-label="Signed-in clients">
					{props.pending === true && <PendingRowSkeleton />}
					{Array.map(Array.range(1, 9), row => (
						<ClientRowSkeleton key={row} />
					))}
				</div>
			</div>
		</Card>
	)
}

// The people rows a card will hold while the list loads, with the mark, name, handle and since date.
export function PeopleRowsSkeleton() {
	return (
		<Card size="list">
			<div aria-busy="true" aria-label="People" role="status">
				<div role="list" aria-label="People">
					{Array.map(Array.range(1, 3), row => (
						<Item key={row} aria-hidden size="row">
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
						</Item>
					))}
				</div>
			</div>
		</Card>
	)
}

const BROWSERS: Record<string, string> = {Chrome: chrome, Edge: edge, Firefox: firefox, Safari: safari}

type Client = {app: Option.Option<string>; device: string; kind: 'App' | 'Browser'; name: string}

function Brand(props: {client: Client}) {
	if (props.client.kind === 'Browser') {
		return Option.match(Record.get(BROWSERS, props.client.name), {
			onNone: () => <GlobeIcon />,
			onSome: src => <img src={src} alt="" className="size-3.5" />
		})
	}
	if (Option.isSome(String.match(/claude/iu)(props.client.name))) {
		return <img src={claude} alt="" className="size-3.5" />
	}
	if (Option.isSome(String.match(/codex/iu)(props.client.name))) {
		return <img src={codex} alt="" className="size-3.5 dark:invert" />
	}
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(props.client.name))) return <GraphIcon />
	if (Array.contains(['iPhone', 'iPad'], props.client.device)) {
		return <img src={apple} alt="" className="size-3.5 dark:invert" />
	}
	if (props.client.device === 'Android') return <img src={android} alt="" className="size-3.5" />
	return <HardDrivesIcon />
}

function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => <Brand client={props.client} />,
		onSome: origin => <AppIcon origin={origin} />
	})
}

type SignedInClient = {address: Option.Option<string>; client: Client; label: string; lastActive: number}

function ClientRow(props: {client: SignedInClient; now: number; onSelect: () => void; selected: boolean}) {
	const active = ageLabel(minutesSince(props.client.lastActive, props.now))
	const address = Option.filter(props.client.address, value => value !== props.client.client.device)
	return (
		<div role="listitem">
			<Item
				size="row"
				id={`client-${props.client.label}`}
				tabIndex={0}
				data-selected={props.selected}
				aria-label={`${props.client.client.device}, active ${active}${Option.match(address, {
					onNone: () => '',
					onSome: value => ` · ${value}`
				})}`}
				onFocus={props.onSelect}
			>
				{/* The browser or app is the mark alone, so every row's name starts at the same column. */}
				<ItemMedia className="size-4" role="img" aria-label={props.client.client.name} title={props.client.client.name}>
					<ClientIcon client={props.client.client} />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.client.client.device}</ItemTitle>
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

// The mark of the app or browser that is waiting, from the catalog when it is a Deslop app.
function PendingMark(props: {catalog: readonly {name: string; origin: string}[]; request: PendingAuthorization}) {
	return Option.match(
		Option.map(
			Array.findFirst(
				props.catalog,
				app => String.toLowerCase(app.name) === String.toLowerCase(props.request.clientName)
			),
			app => app.origin
		),
		{
			onNone: () =>
				Boolean.match(props.request.kind === 'Browser', {
					onFalse: () => <HardDrivesIcon />,
					onTrue: () => <GlobeIcon />
				}),
			onSome: origin => <AppIcon origin={origin} />
		}
	)
}

// A waiting sign-in leads the card, tinted, its code under the label; its answer stays on the row.
function PendingRow(props: {
	catalog: readonly {name: string; origin: string}[]
	onSelect: () => void
	request: PendingAuthorization
	selected: boolean
}) {
	const [consent, respond] = useAtom(consentAtom)
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<div role="listitem" className={cn('bg-primary/10', props.selected && 'bg-primary/20')}>
			<Item size="row" id="pending-sign-in" tabIndex={0} onFocus={props.onSelect}>
				<ItemMedia className="size-4" role="img" aria-label={props.request.clientName} title={props.request.clientName}>
					<PendingMark catalog={props.catalog} request={props.request} />
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

function clientsOf(signIns: readonly SignedInApp[], catalog: readonly {name: string; origin: string}[]) {
	const byName = Array.groupBy(catalog, app => String.toLowerCase(app.name))
	return pipe(
		Array.groupBy(withChildActivity(signIns), signIn => signInLabel(signIn.client, signIn.device)),
		Record.values,
		Array.filter(Array.isReadonlyArrayNonEmpty),
		Array.sort(Order.flip(Order.mapInput(Order.Number, newest))),
		Array.map(group => {
			const lastActive = newest(group)
			return {
				address: pipe(
					Array.findFirst(group, signIn => signIn.lastActive === lastActive),
					Option.flatMap(signIn => Option.fromUndefinedOr(signIn.address))
				),
				client: {
					app: Option.map(
						Option.filter(Array.head(byName[String.toLowerCase(group[0].client)] ?? []), () => group[0].kind === 'App'),
						app => app.origin
					),
					device: group[0].device,
					kind: group[0].kind,
					name: group[0].client
				},
				label: signInLabel(group[0].client, group[0].device),
				lastActive
			}
		})
	)
}

const signInListAtom = Atom.make(get =>
	AsyncResult.all({catalog: get(catalogAtom), now: get(minuteAtom), signIns: get(appsAtom)})
)

export function SignInList(props: {checking?: boolean; pending: Option.Option<PendingAuthorization>}) {
	const data = useAtomSuspense(signInListAtom).value
	const clients = clientsOf(data.signIns, data.catalog)
	const checking = props.checking === true && Option.isNone(props.pending)
	const selected = useAtomValue(selectedRowAtom)
	const setSelected = useAtomSet(selectedRowAtom)
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
							onSome: request => (
								<PendingRow
									catalog={data.catalog}
									request={request}
									selected={Option.contains(selected, 'pending-sign-in')}
									onSelect={() => setSelected(Option.some('pending-sign-in'))}
								/>
							)
						}),
					onTrue: () => (
						<div role="status" aria-label="Checking the code">
							<PendingRowSkeleton />
						</div>
					)
				})}
				{Array.map(clients, client => (
					<ClientRow
						key={client.label}
						client={client}
						now={data.now}
						selected={Option.contains(selected, `client-${client.label}`)}
						onSelect={() => setSelected(Option.some(`client-${client.label}`))}
					/>
				))}
			</div>
		</Card>
	)
}
