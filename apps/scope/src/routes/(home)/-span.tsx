import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'

import {ArrowSquareOutIcon, HardDrivesIcon, LockIcon} from '@phosphor-icons/react'
import type {ReactNode} from 'react'

import {AppMark, ThemedMark} from '@deslop/components-web/blocks/marks'
import {RowMark} from '@deslop/components-web/blocks/rows'
import {cn} from '@deslop/components-web/lib/utils'
import {Button} from '@deslop/components-web/ui/button'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {clockOf, durationOf} from '@deslop/runtime/shared/format'

import {attributesOf, errorOf} from '#lib/telemetry.ts'
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

// Effect's HTTP client error as a status line, method and host; anything else stays as the server wrote it.
function ErrorText(props: {message: string}) {
	return Option.match(String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u)(props.message), {
		onNone: () => props.message,
		onSome: parts => {
			const code = parts[1] ?? ''
			const method = parts[2] ?? ''
			const url = parts[3] ?? ''
			return (
				<>
					<span className="font-medium">
						{code} {pipe(STATUS, Record.get(code), Option.getOrElse(Function.constant('')))}
					</span>{' '}
					{method} {String.replace(/^https?:\/\//u, '')(url)}
				</>
			)
		}
	})
}

// What ran outside the apps: GitHub's mark for CI, else a server glyph, each at 16px.
export function OutsideMark(props: {ci: boolean}) {
	if (!props.ci) return <HardDrivesIcon aria-hidden className="text-muted-foreground size-4" />
	return <ThemedMark light={GithubLight} dark={GithubDark} className="size-4" />
}

// A failed span or log reads in the destructive colour.
function failedText(failed: boolean) {
	return cn(failed && 'text-destructive')
}

// The picked span's identity across both columns: its app's mark, its name, where it started, and its duration.
function SpanHeader(props: {span: TraceTree['spans'][number]}) {
	return (
		<TableRow>
			<TableCell colSpan={2}>
				<span className="flex w-0 min-w-full items-center gap-2">
					<RowMark>
						<AppMark name={appName(props.span.service)} fallback={<OutsideMark ci={props.span.runtime === 'ci'} />} />
					</RowMark>
					<span className={cn('truncate', failedText(props.span.status === 'failed'))}>{props.span.name}</span>
					<span className="text-muted-foreground grow basis-0 truncate">
						{`${appName(props.span.service)} · at ${durationOf(props.span.offsetMs)}`}
					</span>
					<span className="ms-auto tabular-nums">{durationOf(props.span.durationMs)}</span>
				</span>
			</TableCell>
		</TableRow>
	)
}

// One detail of the span on one line: what it is, muted and capped on a phone, then its value cut short with the whole of it on hover, and the action it has.
function DetailRow(props: {action?: ReactNode; label: ReactNode; title: string; value: ReactNode}) {
	return (
		<TableRow>
			<TableCell>
				<span className="text-muted-foreground flex max-w-32 items-center gap-1.5 sm:max-w-none">
					<span className="truncate">{props.label}</span>
				</span>
			</TableCell>
			<TableCell className="w-full">
				<span className="flex w-0 min-w-full items-center gap-2" title={props.title}>
					<span className="truncate">{props.value}</span>
					{props.action}
				</span>
			</TableCell>
		</TableRow>
	)
}

// The picked span's header, error, attributes and logs, one ruled row each; an https URL opens from its row's end.
export function SpanDetail(props: {span: TraceTree['spans'][number]}) {
	return (
		<Table aria-label="Span details">
			<TableBody>
				<SpanHeader span={props.span} />
				{Option.match(errorOf(props.span), {
					onNone: Function.constNull,
					onSome: message => (
						<DetailRow
							title={message}
							label={Boolean.match(props.span.status === 'denied', {
								onFalse: Function.constant('error'),
								onTrue: () => (
									<>
										<LockIcon aria-hidden />
										denied
									</>
								)
							})}
							value={
								<span className={failedText(props.span.status === 'failed')}>
									<ErrorText message={message} />
								</span>
							}
						/>
					)
				})}
				{Array.map(attributesOf(props.span), (attribute, index) => (
					<DetailRow
						key={`${attribute.key}:${index}`}
						title={attribute.value}
						label={attribute.key}
						value={attribute.value}
						action={Boolean.match(attribute.key === 'url.full' && String.startsWith('https://')(attribute.value), {
							onFalse: Function.constNull,
							onTrue: () => (
								<Button
									size="icon-xs"
									variant="ghost"
									nativeButton={false}
									render={
										<a href={attribute.value} target="_blank" rel="noreferrer" aria-label={`Open ${attribute.value}`} />
									}
								>
									<ArrowSquareOutIcon />
								</Button>
							)
						})}
					/>
				))}
				{Array.map(props.span.logs, (log, index) => (
					<DetailRow
						key={`${log.id}:${index}`}
						title={log.message}
						label={<span className="tabular-nums">{clockOf(log.time, 'millisecond')}</span>}
						value={<span className={failedText(log.severity >= 17)}>{log.message}</span>}
					/>
				))}
			</TableBody>
		</Table>
	)
}
