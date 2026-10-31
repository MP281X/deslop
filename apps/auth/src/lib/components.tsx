import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, Record, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {X} from 'lucide-react'
import {useState} from 'react'
import {toQR} from 'toqr'

import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldDescription} from '@deslop/components-web/ui/field'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@deslop/components-web/ui/table'

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

function Absent(props: {label: string}) {
	return (
		<TableCell className="text-muted-foreground text-center" aria-label={props.label}>
			·
		</TableCell>
	)
}

// A first tap arms the cell, a second signs that client out of that app; leaving the cell disarms it.
function Cell(props: {app: string; client: string; now: number; signIns: SignedInApp[]}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const [armed, setArmed] = useState(false)
	if (Array.isArrayEmpty(props.signIns)) return <Absent label={`${props.client} is not signed in to ${props.app}`} />
	const minutes = minutesSince(newest(props.signIns), props.now)
	return (
		<TableCell>
			<Button
				variant={Boolean.match(armed, {onFalse: () => 'ghost' as const, onTrue: () => 'destructive' as const})}
				className="w-full font-mono"
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
							{ageLabel(minutes)}
						</>
					),
					onTrue: () => <X />
				})}
			</Button>
		</TableCell>
	)
}

// The waiting sign-in as the grid's top row: a hollow dot marked new for each app it asks for.
function PendingRow(props: {columns: string[]; request: PendingAuthorization}) {
	const asked = appNames(props.request.resources)
	const client = signInLabel(props.request.clientName, props.request.device)
	return (
		<TableRow>
			<TableHead scope="row" className="text-primary wrap-anywhere whitespace-normal">
				{client}
			</TableHead>
			{Array.map(props.columns, column =>
				Boolean.match(Array.contains(asked, column), {
					onFalse: () => <Absent key={column} label={`${client} does not ask for ${column}`} />,
					onTrue: () => (
						<TableCell key={column} aria-label={`${client} asks for ${column}`}>
							<span className="text-primary flex items-center justify-center gap-1.5 font-mono">
								<StatusDot status="off" className="border-primary" />
								new
							</span>
						</TableCell>
					)
				})
			)}
		</TableRow>
	)
}

// A failed answer stays under the grid to retry. Where the sign-in started tells a stranger's code from one's own.
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

// Clients down, apps across, last active first; a waiting sign-in sits on top, answered under the grid.
export function SignedInGrid(props: {pending: Option.Option<PendingAuthorization>}) {
	const apps = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	const [disconnection] = useAtom(disconnectAtom)
	// A browser asks for no app, only the session, so it adds no row.
	const pendingApp = Option.filter(props.pending, request => request.kind === 'App')
	const asked = Option.match(pendingApp, {onNone: () => [], onSome: request => appNames(request.resources)})
	const columns = Array.sort(
		Array.dedupe([...Array.flatMap(apps, app => appNames(app.resources)), ...asked]),
		String.Order
	)
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
					<Table className="table-fixed">
						<TableHeader>
							<TableRow>
								<TableHead className="w-32">
									<span className="sr-only">Client</span>
								</TableHead>
								{Array.map(columns, column => (
									<TableHead
										key={column}
										scope="col"
										className="text-muted-foreground text-center font-mono font-normal"
									>
										{column}
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{Option.match(pendingApp, {
								onNone: () => null,
								onSome: request => <PendingRow columns={columns} request={request} />
							})}
							{Array.map(rows, row => (
								<TableRow key={row[0]}>
									<TableHead scope="row" className="wrap-anywhere whitespace-normal">
										{row[0]}
									</TableHead>
									{Array.map(columns, column => (
										<Cell
											key={column}
											app={column}
											client={row[0]}
											now={now}
											signIns={Array.filter(row[1], app => Array.contains(appNames(app.resources), column))}
										/>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
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
