import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, Order, Record, String, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useEffect, useState} from 'react'
import {toQR} from 'toqr'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
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
	disconnectAtom,
	minuteAtom,
	minutesSince,
	newest,
	pendingAtom,
	requestCode,
	selectedRowAtom,
	signInLabel
} from '#lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
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

export function AccountAvatar(props: {id: string; name: string}) {
	return (
		<Avatar size="sm">
			<AvatarImage src={avatarUrl(props.id)} alt={props.name} />
			<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(props.name))}</AvatarFallback>
		</Avatar>
	)
}

// A glyph until the app's own icon loads, so a missing icon never draws the browser's broken image; no tile behind either.
export function AppIcon(props: {origin: string; small?: boolean}) {
	const [state, setState] = useState<'failed' | 'loaded' | 'loading'>('loading')
	return (
		<span
			className={cn(
				'text-muted-foreground relative flex shrink-0 items-center justify-center',
				Boolean.match(props.small === true, {onFalse: () => 'size-5', onTrue: () => 'size-4'})
			)}
		>
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

const BROWSERS: Record<string, string> = {Chrome: chrome, Edge: edge, Firefox: firefox, Safari: safari}

function brandLogoOf(client: Client) {
	if (client.kind === 'Browser') return Option.map(Record.get(BROWSERS, client.name), src => ({invert: false, src}))
	if (Option.isSome(String.match(/claude/iu)(client.name))) return Option.some({invert: false, src: claude})
	if (Option.isSome(String.match(/codex/iu)(client.name))) return Option.some({invert: true, src: codex})
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(client.name))) return Option.none()
	if (Array.contains(['iPhone', 'iPad'], client.device)) return Option.some({invert: true, src: apple})
	if (client.device === 'Android') return Option.some({invert: false, src: android})
	return Option.none()
}

type Client = {app: Option.Option<string>; device: string; kind: 'App' | 'Browser'; name: string}

function Brand(props: {client: Client}) {
	return Option.match(brandLogoOf(props.client), {
		onNone: () =>
			pipe(
				Match.value(props.client),
				Match.when({kind: 'Browser'}, () => <GlobeIcon />),
				Match.when(
					client => Option.isSome(String.match(/gateway/iu)(client.name)),
					() => <GraphIcon />
				),
				Match.orElse(() => <HardDrivesIcon />)
			),
		onSome: brand => <img src={brand.src} alt="" className={cn('size-3.5', brand.invert && 'dark:invert')} />
	})
}

function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => <Brand client={props.client} />,
		onSome: origin => <AppIcon origin={origin} small />
	})
}

type SignedInClient = {
	address: Option.Option<string>
	client: Client
	families: string[]
	label: string
	lastActive: number
}

function ClientRow(props: {
	client: SignedInClient
	disconnecting: boolean
	now: number
	onDisconnect: () => void
	onSelect: () => void
	selected: boolean
}) {
	const active = ageLabel(minutesSince(props.client.lastActive, props.now))
	const address = Option.filter(props.client.address, value => value !== props.client.client.device)
	return (
		<div role="listitem">
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<Item
							size="row"
							id={`client-${props.client.label}`}
							tabIndex={0}
							data-selected={props.selected}
							aria-label={`${props.client.label}, active ${active}${Option.match(address, {
								onNone: () => '',
								onSome: value => ` · ${value}`
							})}`}
							onFocus={props.onSelect}
						/>
					}
				>
					<ItemMedia className="size-4">
						<ClientIcon client={props.client.client} />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{props.client.label}</ItemTitle>
					</ItemContent>
					<ItemActions>
						<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{active}</span>
						<span className="text-muted-foreground w-28 shrink-0 truncate text-right font-mono text-xs max-sm:hidden">
							{Option.getOrElse(address, () => '')}
						</span>
					</ItemActions>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					<ContextMenuItem
						variant="destructive"
						className="max-sm:h-11"
						disabled={props.disconnecting}
						onClick={props.onDisconnect}
					>
						Sign out
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
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
			onSome: origin => <AppIcon origin={origin} small />
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
	const label = signInLabel(props.request.clientName, props.request.device)
	return (
		<div role="listitem" className={cn('bg-primary/10', props.selected && 'bg-primary/20')}>
			<Item size="row" id="pending-sign-in" tabIndex={0} onFocus={props.onSelect}>
				<ItemMedia className="size-4">
					<PendingMark catalog={props.catalog} request={props.request} />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{label}</ItemTitle>
					<ItemDescription>{requestCode(props.request.id)}</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button
						variant="outline"
						size="sm"
						disabled={waiting}
						aria-label={`Deny ${label}`}
						onClick={() => respond({accept: false, request: props.request})}
					>
						Deny
					</Button>
					<Button
						size="sm"
						disabled={waiting}
						aria-label={`Approve ${label}`}
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

function clientsWithChildActivity(signIns: readonly SignedInApp[], catalog: readonly {name: string; origin: string}[]) {
	const children = Array.groupBy(
		Array.filter(signIns, signIn => signIn.parent !== undefined),
		signIn => signIn.parent ?? ''
	)
	const parents = Array.map(
		Array.filter(signIns, signIn => signIn.parent === undefined),
		signIn => {
			if (signIn.kind !== 'Browser') return signIn
			return {
				...signIn,
				lastActive: Array.reduce(
					Option.getOrElse(Record.get(children, signIn.family), () => []),
					signIn.lastActive,
					(latest, app) => Number.max(latest, app.lastActive)
				)
			}
		}
	)
	const byName = Array.groupBy(catalog, app => String.toLowerCase(app.name))
	return pipe(
		Array.groupBy(parents, signIn => signInLabel(signIn.client, signIn.device)),
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
				families: Array.map(group, signIn => signIn.family),
				label: signInLabel(group[0].client, group[0].device),
				lastActive
			}
		})
	)
}

const signInListAtom = Atom.make(get =>
	AsyncResult.all({catalog: get(catalogAtom), now: get(minuteAtom), signIns: get(appsAtom)})
)

export function SignInList(props: {pending: Option.Option<PendingAuthorization>}) {
	const data = useAtomSuspense(signInListAtom).value
	const clients = clientsOf(data.signIns, data.catalog)
	const selected = useAtomValue(selectedRowAtom)
	const setSelected = useAtomSet(selectedRowAtom)
	const setPending = useAtomSet(pendingAtom)
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	useEffect(() => setPending(props.pending), [props.pending, setPending])
	if (Array.isReadonlyArrayEmpty(clients) && Option.isNone(props.pending)) {
		return <EmptyState label="No sign-ins" icon={<HardDrivesIcon className="size-5" weight="light" />} />
	}
	return (
		<>
			<Card size="list">
				<div role="list" aria-label="Signed-in clients">
					{Option.match(props.pending, {
						onNone: () => null,
						onSome: request => (
							<PendingRow
								catalog={data.catalog}
								request={request}
								selected={Option.contains(selected, 'pending-sign-in')}
								onSelect={() => setSelected(Option.some('pending-sign-in'))}
							/>
						)
					})}
					{Array.map(clients, client => (
						<ClientRow
							key={client.label}
							client={client}
							now={data.now}
							selected={Option.contains(selected, `client-${client.label}`)}
							onSelect={() => setSelected(Option.some(`client-${client.label}`))}
							disconnecting={AsyncResult.isWaiting(disconnection)}
							onDisconnect={() => disconnect(client.families)}
						/>
					))}
				</div>
			</Card>
			<div className="px-4">
				<ResultError result={disconnection} />
			</div>
		</>
	)
}
