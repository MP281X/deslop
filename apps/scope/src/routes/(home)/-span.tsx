import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'

import {HardDrivesIcon, LockIcon} from '@phosphor-icons/react'
import type {ReactElement, ReactNode} from 'react'

import {cn} from '@deslop/components-web/classes'
import {AppMark, ThemedMark} from '@deslop/components-web/marks'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle
} from '@deslop/components-web/ui/item'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
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
		onNone: () => <span className="break-words">{props.message}</span>,
		onSome: parts => {
			const code = parts[1] ?? ''
			const method = parts[2] ?? ''
			const url = parts[3] ?? ''
			return (
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2 break-words">
					<span className="font-medium">
						{code} {pipe(STATUS, Record.get(code), Option.getOrElse(Function.constant('')))}
					</span>
					<span>{method}</span>
					<span className="min-w-0 break-all">{String.replace(/^https?:\/\//u, '')(url)}</span>
				</span>
			)
		}
	})
}

// What ran outside the apps: GitHub's mark for CI, a little inside its 16px slot as the pixel icons are, else a server glyph.
export function OutsideMark(props: {ci: boolean}) {
	if (!props.ci) return <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
	return (
		<span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
			<ThemedMark light={GithubLight} dark={GithubDark} className="size-3.5" />
		</span>
	)
}

// A failed span or log reads in the destructive colour.
function failedText(failed: boolean) {
	return cn(failed && 'text-destructive')
}

// The picked span's identity above its details: its app's mark, its name, where it started, and its duration.
function SpanHeader(props: {span: TraceTree['spans'][number]}) {
	return (
		<Item role="listitem" size="sm">
			<ItemMedia variant="icon">
				<AppMark name={appName(props.span.service)} fallback={<OutsideMark ci={props.span.runtime === 'ci'} />} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className={failedText(props.span.status === 'failed')}>{props.span.name}</span>
				</ItemTitle>
				<ItemDescription>{`${appName(props.span.service)} · at ${durationOf(props.span.offsetMs)}`}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<span className="tabular-nums">{durationOf(props.span.durationMs)}</span>
			</ItemActions>
		</Item>
	)
}

// One detail of the span: what it is above its value; an https URL's row opens it.
function DetailRow(props: {label: ReactNode; render?: ReactElement; title: string; value: ReactNode}) {
	return (
		<Item role="listitem" size="sm" title={props.title} render={props.render}>
			<ItemContent>
				<ItemDescription>{props.label}</ItemDescription>
				<ItemTitle>{props.value}</ItemTitle>
			</ItemContent>
		</Item>
	)
}

// The picked span's header, error, attributes and logs, as stock list rows.
export function SpanDetail(props: {span: TraceTree['spans'][number]}) {
	const error = errorOf(props.span)
	const attributes = attributesOf(props.span)
	return (
		<ItemGroup aria-label="Span details">
			<SpanHeader span={props.span} />
			{Option.match(error, {
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
			{Array.map(attributes, (attribute, index) =>
				Boolean.match(attribute.key === 'url.full' && String.startsWith('https://')(attribute.value), {
					onFalse: () => (
						<DetailRow
							key={`${attribute.key}:${index}`}
							title={attribute.value}
							label={attribute.key}
							value={attribute.value}
						/>
					),
					onTrue: () => (
						<DetailRow
							key={`${attribute.key}:${index}`}
							title={attribute.value}
							label={attribute.key}
							value={attribute.value}
							render={<a href={attribute.value} target="_blank" rel="noreferrer" aria-label={attribute.value} />}
						/>
					)
				})
			)}
			{Array.map(props.span.logs, (log, index) => (
				<DetailRow
					key={`${log.id}:${index}`}
					title={log.message}
					label={clockOf(log.time, 'millisecond')}
					value={<span className={failedText(log.severity >= 17)}>{log.message}</span>}
				/>
			))}
		</ItemGroup>
	)
}
