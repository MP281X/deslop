import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, Record, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {X} from 'lucide-react'
import {useState} from 'react'
import {toQR} from 'toqr'

import {ItemList} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldDescription} from '@deslop/components-web/ui/field'
import {Item, ItemContent, ItemTitle} from '@deslop/components-web/ui/item'

import {
	ageLabel,
	appNames,
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

// A first tap arms the chip, a second signs that client out of that app; leaving the chip disarms it.
function AppChip(props: {app: string; client: string; now: number; signIns: SignedInApp[]}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const [armed, setArmed] = useState(false)
	const minutes = minutesSince(newest(props.signIns), props.now)
	return (
		<Button
			size="sm"
			variant={Boolean.match(armed, {onFalse: () => 'outline' as const, onTrue: () => 'destructive' as const})}
			aria-label={Boolean.match(armed, {
				onFalse: () =>
					`${props.client} in ${props.app} on ${machines(props.signIns.length)}, active ${Boolean.match(minutes < 1, {onFalse: () => `${ageLabel(minutes)} ago`, onTrue: () => 'now'})}; tap twice to sign out`,
				onTrue: () => `Sign ${props.client} out of ${props.app}`
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
						{props.app}
						<span className="text-muted-foreground font-mono">{ageLabel(minutes)}</span>
					</>
				),
				onTrue: () => (
					<>
						<X />
						Sign out of {props.app}
					</>
				)
			})}
		</Button>
	)
}

// The waiting sign-in on top, each app it asks for marked new.
function PendingItem(props: {request: PendingAuthorization}) {
	return (
		<Item role="listitem" size="sm">
			<ItemContent>
				<ItemTitle className="text-primary">{signInLabel(props.request.clientName, props.request.device)}</ItemTitle>
				<div className="flex flex-wrap gap-1">
					{Array.map(appNames(props.request.resources), app => (
						<Badge key={app} variant="outline" className="text-primary">
							<StatusDot status="off" className="border-primary" />
							{app}
							<span className="font-mono">new</span>
						</Badge>
					))}
				</div>
			</ItemContent>
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

// One row per client, last active first, with a chip per app it holds; a waiting sign-in sits on top, answered below.
export function SignedInList(props: {pending: Option.Option<PendingAuthorization>}) {
	const apps = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	const [disconnection] = useAtom(disconnectAtom)
	// A browser asks for no app, only the session, so it adds no row.
	const pendingApp = Option.filter(props.pending, request => request.kind === 'App')
	const rows = pipe(
		Array.groupBy(apps, app => signInLabel(app.client, app.device)),
		Record.toEntries,
		Array.sort(Order.flip(Order.mapInput(Order.Number, (entry: [string, SignedInApp[]]) => newest(entry[1]))))
	)
	return (
		<section className="flex flex-col gap-3" aria-label="Signed in">
			<h2 className="text-muted-foreground flex justify-between font-mono text-xs">
				signed in · last active
				{Option.match(props.pending, {
					onNone: () => null,
					onSome: request => <span>request open until {timeLabel(request.expiresAt)}</span>
				})}
			</h2>
			{Boolean.match(Array.isArrayEmpty(rows) && Option.isNone(pendingApp), {
				onFalse: () => (
					<ItemList label="Signed-in clients">
						{[
							...Option.match(pendingApp, {
								onNone: () => [],
								onSome: request => [<PendingItem key="pending" request={request} />]
							}),
							...Array.map(rows, row => (
								<Item key={row[0]} role="listitem" size="sm">
									<ItemContent>
										<ItemTitle>{row[0]}</ItemTitle>
										<div className="flex flex-wrap gap-1">
											{Array.map(
												Array.sort(Array.dedupe(Array.flatMap(row[1], app => appNames(app.resources))), String.Order),
												app => (
													<AppChip
														key={app}
														app={app}
														client={row[0]}
														now={now}
														signIns={Array.filter(row[1], signIn => Array.contains(appNames(signIn.resources), app))}
													/>
												)
											)}
										</div>
									</ItemContent>
								</Item>
							))
						]}
					</ItemList>
				),
				onTrue: () => (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No apps signed in</EmptyTitle>
							<EmptyDescription>
								An app you sign in to shows here, with where and when it was last used.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)
			})}
			{Option.match(props.pending, {onNone: () => null, onSome: request => <Answer request={request} />})}
			<ResultError result={disconnection} />
		</section>
	)
}
