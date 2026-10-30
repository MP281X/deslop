import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, Record, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {X} from 'lucide-react'
import {useState} from 'react'
import {toQR} from 'toqr'

import {Button} from '@deslop/components-web/ui/button'
import {cn} from '@deslop/components-web/utils'

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

// Lucide has no brand icons; this is GitHub's mark from its Octicons.
export function GitHubIcon(props: {className?: string}) {
	return (
		<svg viewBox="0 0 16 16" fill="currentColor" className={props.className} aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	)
}

export function Avatar(props: {id: string; name: string}) {
	return <img src={avatarUrl(props.id)} alt={props.name} className="bg-muted size-6 shrink-0" />
}

function machines(count: number) {
	if (count === 1) return '1 machine'
	return `${count} machines`
}

// A first tap arms the cell, a second signs that client out of that app; leaving the cell disarms it.
function Cell(props: {app: string; client: string; now: number; signIns: SignedInApp[]}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const [armed, setArmed] = useState(false)
	if (Array.isArrayEmpty(props.signIns)) {
		return (
			<td
				className="text-muted-foreground/40 text-center"
				aria-label={`${props.client} is not signed in to ${props.app}`}
			>
				·
			</td>
		)
	}
	const minutes = minutesSince(newest(props.signIns), props.now)
	return (
		<td className="p-0.5">
			<Button
				size="lg"
				variant={Boolean.match(armed, {onFalse: () => 'secondary' as const, onTrue: () => 'destructive' as const})}
				className="w-full flex-col gap-1 text-xs tabular-nums"
				aria-label={Boolean.match(armed, {
					onFalse: () =>
						`${props.client} in ${props.app} on ${machines(props.signIns.length)}, active ${ageLabel(minutes)} ago; tap twice to sign out`,
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
					// One square per machine, lit while it was active in the last hour.
					onFalse: () => (
						<>
							{ageLabel(minutes)}
							<span className="flex gap-0.5" aria-hidden="true">
								{Array.map(props.signIns, signIn => (
									<span
										key={signIn.family}
										className={cn(
											'size-1',
											minutesSince(signIn.lastActive, props.now) < 60 && 'bg-primary',
											minutesSince(signIn.lastActive, props.now) >= 60 && 'bg-muted-foreground/50'
										)}
									/>
								))}
							</span>
						</>
					),
					onTrue: () => <X />
				})}
			</Button>
		</td>
	)
}

// The waiting sign-in as the grid's top row: an outlined cell for each app it asks for.
function PendingRow(props: {columns: string[]; request: PendingAuthorization}) {
	const asked = appNames(props.request.resources)
	const client = signInLabel(props.request.clientName, props.request.device)
	return (
		<tr>
			<th scope="row" className="text-primary pr-2 text-left text-xs font-normal wrap-anywhere">
				{client}
			</th>
			{Array.map(props.columns, column =>
				Boolean.match(Array.contains(asked, column), {
					onFalse: () => (
						<td
							key={column}
							className="text-muted-foreground/40 text-center"
							aria-label={`${client} does not ask for ${column}`}
						>
							·
						</td>
					),
					onTrue: () => (
						<td key={column} className="p-0.5" aria-label={`${client} asks for ${column}`}>
							<span className="border-primary text-primary flex h-9 items-center justify-center border text-xs">
								new
							</span>
						</td>
					)
				})
			)}
		</tr>
	)
}

// A failed answer stays under the grid to retry. Where the sign-in started tells a stranger's code from one's own.
function Answer(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	return (
		<>
			<p className="text-muted-foreground text-xs">
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
			</p>
			{Option.match(AsyncResult.error(consent), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-xs" role="alert">
						{failure.message}
					</p>
				)
			})}
			<div className="grid grid-cols-2 gap-1.5 text-xs">
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
					variant="secondary"
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
		<section className="flex flex-col gap-2" aria-label="Signed in">
			<h2 className="text-muted-foreground flex justify-between text-xs tracking-wider uppercase">
				Signed in
				{Option.match(props.pending, {
					onNone: () => null,
					onSome: request => (
						<span className="tracking-normal normal-case tabular-nums">until {timeLabel(request.expiresAt)}</span>
					)
				})}
			</h2>
			{Boolean.match(Array.isArrayEmpty(rows) && Option.isNone(pendingApp), {
				onFalse: () => (
					<table className="w-full table-fixed border-collapse text-sm">
						<thead>
							<tr>
								<th className="w-28">
									<span className="sr-only">Client</span>
								</th>
								{Array.map(columns, column => (
									<th key={column} scope="col" className="text-muted-foreground pb-1 text-xs font-normal">
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{Option.match(pendingApp, {
								onNone: () => null,
								onSome: request => <PendingRow columns={columns} request={request} />
							})}
							{Array.map(rows, row => (
								<tr key={row[0]}>
									<th scope="row" className="text-muted-foreground pr-2 text-left text-xs font-normal wrap-anywhere">
										{row[0]}
									</th>
									{Array.map(columns, column => (
										<Cell
											key={column}
											app={column}
											client={row[0]}
											now={now}
											signIns={Array.filter(row[1], app => Array.contains(appNames(app.resources), column))}
										/>
									))}
								</tr>
							))}
						</tbody>
					</table>
				),
				onTrue: () => <p className="text-muted-foreground text-xs">No apps signed in</p>
			})}
			{Option.match(props.pending, {onNone: () => null, onSome: request => <Answer request={request} />})}
			{Option.match(AsyncResult.error(disconnection), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-xs" role="alert">
						{failure.message}
					</p>
				)
			})}
		</section>
	)
}
