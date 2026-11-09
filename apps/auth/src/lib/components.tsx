import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, Order, Record, String, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import {toQR} from 'toqr'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {Section} from '@deslop/components-web/page'
import {ResultError} from '@deslop/components-web/result-error'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {FieldDescription} from '@deslop/components-web/ui/field'
import {Spinner} from '@deslop/components-web/ui/spinner'
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

// A GitHub account's picture, or its first letter until the picture loads.
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

// A browser, harness or app platform's logo; `mono` marks a black one that turns white on the dark page.
function brandOf(client: Client) {
	if (client.kind === 'Browser') return Option.map(Record.get(BROWSERS, client.name), src => ({mono: false, src}))
	if (Option.isSome(String.match(/claude/iu)(client.name))) return Option.some({mono: false, src: claude})
	if (Option.isSome(String.match(/codex/iu)(client.name))) return Option.some({mono: true, src: codex})
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(client.name))) return Option.none()
	if (Array.contains(['iPhone', 'iPad'], client.device)) return Option.some({mono: true, src: apple})
	if (client.device === 'Android') return Option.some({mono: false, src: android})
	return Option.none()
}

// `app` is the origin of the Deslop app the client is, such as Stash on an iPhone, whose own icon marks it.
type Client = {app: Option.Option<string>; device: string; kind: 'App' | 'Browser'; name: string}

// A brand's logo when the client has one, else a glyph for the gateway, a browser or the machine it runs on.
function Brand(props: {client: Client}) {
	return Option.match(brandOf(props.client), {
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
		onSome: brand => <img src={brand.src} alt="" className={cn('size-3.5', brand.mono && 'dark:invert')} />
	})
}

// The kind of client: a Deslop app's own icon, else its brand or a glyph.
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

function ClientRow(props: {client: SignedInClient; index: number; now: number}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom(props.client.label))
	const minutes = minutesSince(props.client.lastActive, props.now)
	const active = `active ${Boolean.match(minutes < 1, {onFalse: () => `${ageLabel(minutes)} ago`, onTrue: () => 'now'})}`
	const address = Option.filter(props.client.address, value => value !== props.client.client.device)
	return (
		<ContextMenu>
			<div role="listitem" className="border-b">
				<ContextMenuTrigger
					render={
						<div
							role="button"
							tabIndex={0}
							aria-haspopup="menu"
							aria-label={`${props.client.label}, ${Array.join([active, ...Option.toArray(address)], ' · ')}`}
							className="hover:bg-accent flex h-12 min-w-0 items-center gap-3 px-0 text-sm max-sm:h-12"
						/>
					}
				>
					<span className="text-muted-foreground text-label tracking-label w-6 shrink-0 text-right font-mono tabular-nums">
						{String.padStart(2, '0')(`${props.index}`)}
					</span>
					<ClientIcon client={props.client.client} />
					<span className="min-w-0 flex-1 truncate font-medium">{props.client.label}</span>
					<span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{active}</span>
					{Option.match(address, {
						onNone: () => null,
						onSome: value => (
							<span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums max-sm:hidden">
								{value}
							</span>
						)
					})}
				</ContextMenuTrigger>
				<ResultError result={disconnection} className="mr-1 mb-2 ml-14 wrap-anywhere" />
			</div>
			<ContextMenuContent className="w-auto min-w-36">
				<ContextMenuItem
					variant="destructive"
					className="max-sm:h-11"
					disabled={AsyncResult.isWaiting(disconnection)}
					onClick={() => disconnect(props.client.families)}
				>
					Sign out
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

// A failed answer stays above the clients to retry. Where the sign-in started tells a stranger's code from one's own.
function Answer(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	const [choice, setChoice] = useState<boolean>()
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<div className="bg-card flex flex-col gap-3 border p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 className="font-heading text-2xl leading-none tracking-tight">A sign-in is waiting</h2>
				<span className="text-muted-foreground font-mono text-xs tabular-nums">
					{signInLabel(props.request.clientName, props.request.device)}
				</span>
			</div>
			<FieldDescription>
				{Boolean.match(props.request.kind === 'Browser', {
					onFalse: () =>
						`Signs ${signInLabel(props.request.clientName, props.request.device)} in as you to every mp281x.xyz app for 30 days`,
					onTrue: () =>
						`Signs in ${signInLabel(props.request.clientName, props.request.device)} as you to every mp281x.xyz app for 30 days, including approving sign-ins`
				})}
				{Option.match(
					Option.filter(Option.fromUndefinedOr(props.request.address), address => address !== props.request.device),
					{onNone: () => '', onSome: address => ` · from ${address}`}
				)}
				. Approve only a code you started yourself.
			</FieldDescription>
			<ResultError result={consent} />
			<div className="grid grid-cols-2 gap-2">
				<Button
					size="lg"
					aria-label={`Approve ${signInLabel(props.request.clientName, props.request.device)}`}
					disabled={waiting}
					onClick={() => {
						setChoice(true)
						respond({accept: true, request: props.request})
					}}
				>
					{Boolean.match(waiting && choice === true, {onFalse: () => null, onTrue: () => <Spinner />})}
					Approve
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={waiting}
					onClick={() => {
						setChoice(false)
						respond({accept: false, request: props.request})
					}}
				>
					{Boolean.match(waiting && choice === false, {onFalse: () => null, onTrue: () => <Spinner />})}
					Deny
				</Button>
			</div>
		</div>
	)
}

// Browser children contribute activity to their browser, never rows of their own.
function clientsOf(signIns: readonly SignedInApp[], catalog: readonly {name: string; origin: string}[]) {
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
	return (
		<Section
			title="Signed in"
			figure={
				<span
					className="text-figure font-mono leading-none tabular-nums"
					aria-label={`${clients.length} signed-in ${Boolean.match(clients.length === 1, {onFalse: () => 'clients', onTrue: () => 'client'})}`}
				>
					{String.padStart(2, '0')(`${clients.length}`)}
				</span>
			}
			className="gap-0"
		>
			{Option.match(props.pending, {onNone: () => null, onSome: request => <Answer request={request} />})}
			{Array.match(clients, {
				onEmpty: () => (
					<EmptyState
						label="No sign-ins"
						description="A browser, app or command appears here once it signs in."
						icon={<HardDrivesIcon className="size-5" weight="light" />}
					/>
				),
				onNonEmpty: rows => (
					<div role="list" aria-label="Signed-in clients">
						{Array.map(rows, (client, index) => (
							<ClientRow key={client.label} client={client} index={index + 1} now={data.now} />
						))}
					</div>
				)
			})}
		</Section>
	)
}
