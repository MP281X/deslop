import {Array, Boolean, Option, Record, String, pipe} from 'effect'

import {HardDrivesIcon, LockIcon} from '@phosphor-icons/react'

import {appMarks} from '@deslop/components-web/apps'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn} from '@deslop/components-web/utils'

import {attributesOf, durationOf, errorOf} from '#lib/utils.ts'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {TraceTree} from '#services/telemetry/schema.ts'

const STATUS: Record<string, string> = {
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	409: 'Conflict',
	422: 'Unprocessable',
	429: 'Too Many Requests',
	500: 'Server Error',
	502: 'Bad Gateway',
	503: 'Unavailable',
	504: 'Gateway Timeout'
}

const preciseClock = new Intl.DateTimeFormat(undefined, {
	fractionalSecondDigits: 3,
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	second: '2-digit'
})

// Effect's HTTP client error as a status line, method and host; anything else stays as the server wrote it.
function ErrorText(props: {message: string}) {
	return Option.match(String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u)(props.message), {
		onNone: () => <span className="break-words">{props.message}</span>,
		onSome: parts => {
			const code = parts[1] ?? ''
			const method = parts[2] ?? ''
			const url = parts[3] ?? ''
			return (
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2 break-words">
					<span className="font-medium">
						{code} {pipe(STATUS, Record.get(code), Option.getOrElse(() => ''))}
					</span>
					<span>{method}</span>
					<span className="min-w-0 break-all">{String.replace(/^https?:\/\//u, '')(url)}</span>
				</span>
			)
		}
	})
}

// GitHub's mark for a CI app or span, filling its 16px slot where the pixel icons keep a margin.
export function CiMark() {
	return (
		<span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
			<GithubLight className="size-3.5 dark:hidden" />
			<GithubDark className="hidden size-3.5 dark:block" />
		</span>
	)
}

// The mark of the app that ran a span: its own icon, GitHub's for CI, else a server glyph.
function SpanMark(props: {span: TraceTree['spans'][number]}) {
	return Option.match(Option.fromUndefinedOr(appMarks[appName(props.span.service)]), {
		onNone: () =>
			Boolean.match(props.span.runtime === 'ci', {
				onFalse: () => <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />,
				onTrue: () => <CiMark />
			}),
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
	})
}

// The picked span's identity above its details: its app's mark, its name, where it started, and its duration.
function SpanHeader(props: {span: TraceTree['spans'][number]}) {
	return (
		<div role="listitem" className="col-span-2 flex h-8 items-center gap-3 max-sm:h-11">
			<SpanMark span={props.span} />
			<span
				className={cn(
					'min-w-0 truncate',
					Boolean.match(props.span.status === 'failed', {onFalse: () => undefined, onTrue: () => 'text-destructive'})
				)}
			>
				{props.span.name}
			</span>
			<span className="text-muted-foreground shrink-0 truncate">
				{`${appName(props.span.service)} · at ${durationOf(props.span.offsetMs)}`}
			</span>
			<span className="ml-auto shrink-0 tabular-nums">{durationOf(props.span.durationMs)}</span>
		</div>
	)
}

// The picked span's header, error, attributes and logs, as stock-height rows with no dividers between them.
export function SpanDetail(props: {span: TraceTree['spans'][number]}) {
	const error = errorOf(props.span)
	const attributes = attributesOf(props.span)
	return (
		<div
			role="list"
			aria-label="Span details"
			className="grid-cols-detail max-sm:grid-cols-detail-phone grid px-4 text-xs"
		>
			<SpanHeader span={props.span} />
			{Option.match(error, {
				onNone: () => null,
				onSome: message => (
					<div role="listitem" className="col-span-2 grid h-8 grid-cols-subgrid items-center gap-2.5 max-sm:h-11">
						<span className="text-muted-foreground flex items-center gap-1.5 truncate">
							{Boolean.match(props.span.status === 'denied', {
								onFalse: () => 'error',
								onTrue: () => (
									<>
										<LockIcon aria-hidden className="size-3 shrink-0" />
										denied
									</>
								)
							})}
						</span>
						<span
							className={cn(
								'block min-w-0 truncate',
								Boolean.match(props.span.status === 'failed', {
									onFalse: () => undefined,
									onTrue: () => 'text-destructive'
								})
							)}
							title={message}
						>
							<ErrorText message={message} />
						</span>
					</div>
				)
			})}
			{Array.map(attributes, (attribute, index) => (
				<div
					key={`${attribute.key}:${index}`}
					role="listitem"
					className="col-span-2 grid h-8 grid-cols-subgrid items-center gap-2.5 max-sm:h-11"
				>
					<span className="text-muted-foreground truncate" title={attribute.key}>
						{attribute.key}
					</span>
					<span className="block min-w-0 truncate select-text" title={attribute.value}>
						{Boolean.match(attribute.key === 'url.full' && String.startsWith('https://')(attribute.value), {
							onFalse: () => attribute.value,
							onTrue: () => (
								<a href={attribute.value} target="_blank" rel="noreferrer" className="text-primary">
									{attribute.value}
								</a>
							)
						})}
					</span>
				</div>
			))}
			{Array.map(props.span.logs, (log, index) => (
				<div
					key={`${log.id}:${index}`}
					role="listitem"
					className="grid-cols-log col-span-2 grid h-8 items-center gap-2.5 max-sm:h-11"
				>
					<span className="text-muted-foreground truncate tabular-nums">{preciseClock.format(log.time)}</span>
					<span
						className={cn(
							'text-muted-foreground block min-w-0 truncate',
							Boolean.match(log.severity >= 17, {onFalse: () => undefined, onTrue: () => 'text-destructive'})
						)}
						title={log.message}
					>
						{log.message}
					</span>
				</div>
			))}
		</div>
	)
}

// The inspector's stock-height rows while its span loads, sharing the same max-content key column as the real ones.
export function DetailSkeleton(props: {label: string}) {
	return (
		<div
			aria-busy="true"
			aria-label={props.label}
			role="status"
			className="grid-cols-detail max-sm:grid-cols-detail-phone grid px-4"
		>
			{Array.map(Array.range(1, 6), row => (
				<div key={row} aria-hidden className="col-span-2 grid h-8 grid-cols-subgrid items-center gap-2.5 max-sm:h-11">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	)
}
