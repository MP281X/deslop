import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Order, Record, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {Activity, AppWindow, ArrowUpRight, Globe, Laptop, Monitor, Server, Smartphone, Tablet, X} from 'lucide-react'
import {useState} from 'react'
import {toQR} from 'toqr'

import {ItemList} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button, buttonVariants} from '@deslop/components-web/ui/button'
import {FieldDescription} from '@deslop/components-web/ui/field'
import {Item, ItemActions, ItemContent, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {cn} from '@deslop/components-web/utils'

import {
	APPS,
	ageLabel,
	appIds,
	appsAtom,
	avatarUrl,
	consentAtom,
	disconnectAtom,
	minuteAtom,
	minutesSince,
	newest,
	signInLabel,
	timeLabel
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

function machines(count: number) {
	if (count === 1) return '1 machine'
	return `${count} machines`
}

// The kind of machine a sign-in runs on, from the device its User-Agent or address names.
function DeviceIcon(props: {device: string}) {
	return pipe(
		Match.value(props.device),
		Match.when(
			device => Array.contains(['iPhone', 'Android'], device),
			() => <Smartphone />
		),
		Match.when('iPad', () => <Tablet />),
		Match.when('Mac', () => <Laptop />),
		Match.when(
			device => Array.contains(['Windows', 'Linux'], device),
			() => <Monitor />
		),
		Match.when(
			device => Array.contains(['dev', 'desktop', 'macbook-pro'], device),
			() => <Server />
		),
		Match.orElse(() => <Globe />)
	)
}

// A first tap arms the chip, a second signs that client out of that app; leaving the chip disarms it.
function ClientChip(props: {app: string; client: string; device: string; now: number; signIns: SignedInApp[]}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const [armed, setArmed] = useState(false)
	const minutes = minutesSince(newest(props.signIns), props.now)
	return (
		<Button
			size="sm"
			variant={Boolean.match(armed, {onFalse: () => 'outline' as const, onTrue: () => 'destructive' as const})}
			aria-label={Boolean.match(armed, {
				onFalse: () =>
					`${signInLabel(props.client, props.device)} in ${props.app} on ${machines(props.signIns.length)}, active ${Boolean.match(minutes < 1, {onFalse: () => `${ageLabel(minutes)} ago`, onTrue: () => 'now'})}; tap twice to sign out`,
				onTrue: () => `Sign ${signInLabel(props.client, props.device)} out of ${props.app}`
			})}
			disabled={AsyncResult.isWaiting(disconnection)}
			onBlur={() => setArmed(false)}
			onClick={() => {
				if (armed) disconnect(Array.map(props.signIns, signIn => signIn.family))
				setArmed(!armed)
			}}
		>
			{Boolean.match(armed, {
				// One dot per machine, lit while it was active in the last hour.
				onFalse: () => (
					<>
						<DeviceIcon device={props.device} />
						{signInLabel(props.client, props.device)}
						<span className="flex gap-0.5">
							{Array.map(props.signIns, signIn => (
								<StatusDot
									key={signIn.family}
									status={Boolean.match(minutesSince(signIn.lastActive, props.now) < 60, {
										onFalse: () => 'quiet' as const,
										onTrue: () => 'live' as const
									})}
								/>
							))}
						</span>
						<span className="text-muted-foreground font-mono">{ageLabel(minutes)}</span>
					</>
				),
				onTrue: () => (
					<>
						<X />
						Sign out
					</>
				)
			})}
		</Button>
	)
}

// A glyph tile until the app's own icon loads, so a missing icon never draws the browser's broken image.
function AppIcon(props: {id: string}) {
	const [state, setState] = useState<'failed' | 'loaded' | 'loading'>('loading')
	return (
		<span className="bg-secondary text-muted-foreground relative flex size-8 items-center justify-center overflow-hidden rounded-md">
			{state !== 'loaded' &&
				pipe(
					Match.value(props.id),
					Match.when('browser', () => <Globe className="size-4" />),
					Match.when('tracing', () => <Activity className="size-4" />),
					Match.orElse(() => <AppWindow className="size-4" />)
				)}
			{state !== 'failed' && Array.some(APPS, app => app.id === props.id) && (
				<img
					src={`https://${props.id}.mp281x.xyz/icon`}
					alt=""
					className={cn('absolute inset-0 size-full', state === 'loading' && 'invisible')}
					onLoad={() => setState('loaded')}
					onError={() => setState('failed')}
				/>
			)}
		</span>
	)
}

// One app: its icon, name and a link to open it, then a chip per client signed in to it, the waiting one first.
function AppRow(props: {
	id: string
	name: string
	now: number
	pending: Option.Option<PendingAuthorization>
	signIns: SignedInApp[]
	url: Option.Option<string>
}) {
	const clients = pipe(
		Array.groupBy(props.signIns, signIn => signInLabel(signIn.client, signIn.device)),
		Record.values,
		Array.sort(Order.flip(Order.mapInput(Order.Number, newest)))
	)
	return (
		<Item role="listitem" size="sm">
			<ItemMedia>
				<AppIcon id={props.id} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.name}</ItemTitle>
				{(Option.isSome(props.pending) || Array.isArrayNonEmpty(clients)) && (
					<div className="flex flex-wrap gap-1">
						{Option.match(props.pending, {
							onNone: () => null,
							onSome: request => (
								<Badge variant="outline" className="text-primary h-6">
									<DeviceIcon device={request.device} />
									{signInLabel(request.clientName, request.device)}
									<span className="font-mono">new</span>
								</Badge>
							)
						})}
						{Array.map(Array.filter(clients, Array.isArrayNonEmpty), signIns => (
							<ClientChip
								key={signIns[0].family}
								app={props.name}
								client={signIns[0].client}
								device={signIns[0].device}
								now={props.now}
								signIns={signIns}
							/>
						))}
					</div>
				)}
			</ItemContent>
			{Option.match(props.url, {
				onNone: () => null,
				onSome: url => (
					<ItemActions>
						<a
							href={url}
							aria-label={`Open ${props.name}`}
							className={buttonVariants({size: 'icon-sm', variant: 'ghost'})}
						>
							<ArrowUpRight />
						</a>
					</ItemActions>
				)
			})}
		</Item>
	)
}

// A failed answer stays under the list to retry. Where the sign-in started tells a stranger's code from one's own.
function Answer(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	return (
		<>
			<FieldDescription>
				{Boolean.match(props.request.kind === 'Browser', {
					onFalse: () => `${signInLabel(props.request.clientName, props.request.device)} asks for the apps marked new`,
					onTrue: () =>
						`Signs in ${signInLabel(props.request.clientName, props.request.device)} as you to every mp281x.xyz app for 30 days, including approving sign-ins`
				})}
				{Option.match(Option.fromUndefinedOr(props.request.address), {
					onNone: () => '',
					onSome: address => ` · from ${address}`
				})}
				. Approve only a code you started yourself.
			</FieldDescription>
			<ResultError result={consent} />
			<div className="grid grid-cols-2 gap-2">
				<Button
					size="lg"
					aria-label={`Approve ${signInLabel(props.request.clientName, props.request.device)}`}
					disabled={AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: true, request: props.request})}
				>
					Approve
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: false, request: props.request})}
				>
					Deny
				</Button>
			</div>
		</>
	)
}

function holding(signIns: readonly SignedInApp[], id: string) {
	return Array.filter(signIns, signIn => Array.contains(appIds(signIn.resources), id))
}

function asking(pending: Option.Option<PendingAuthorization>, id: string) {
	return Option.filter(pending, request => Array.contains(appIds(request.resources), id))
}

// Every app, then the browser session and tracing when something holds them; a waiting sign-in shows on the apps it asks for.
export function AppList(props: {pending: Option.Option<PendingAuthorization>}) {
	const signIns = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	const [disconnection] = useAtom(disconnectAtom)
	const extra = pipe(
		[
			...Array.flatMap(signIns, signIn => appIds(signIn.resources)),
			...Option.match(props.pending, {onNone: () => [], onSome: request => appIds(request.resources)})
		],
		Array.dedupe,
		Array.filter(id => !Array.some(APPS, app => app.id === id)),
		Array.sort(String.Order)
	)
	return (
		<section className="flex flex-col gap-3" aria-label="Apps">
			{Option.match(props.pending, {
				onNone: () => null,
				onSome: request => (
					<p className="text-muted-foreground font-mono text-xs">open until {timeLabel(request.expiresAt)}</p>
				)
			})}
			<ItemList label="Apps">
				{[
					...Array.map(APPS, app => (
						<AppRow
							key={app.id}
							id={app.id}
							name={app.name}
							now={now}
							pending={asking(props.pending, app.id)}
							signIns={holding(signIns, app.id)}
							url={Option.some(app.url)}
						/>
					)),
					...Array.map(extra, id => (
						<AppRow
							key={id}
							id={id}
							name={String.capitalize(id)}
							now={now}
							pending={asking(props.pending, id)}
							signIns={holding(signIns, id)}
							url={Option.none()}
						/>
					))
				]}
			</ItemList>
			{Option.match(props.pending, {onNone: () => null, onSome: request => <Answer request={request} />})}
			<ResultError result={disconnection} />
		</section>
	)
}
