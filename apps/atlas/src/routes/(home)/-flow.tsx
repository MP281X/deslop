import {Array, Boolean, DateTime, Match, Number, Option, pipe} from 'effect'

import {ChartBarHorizontalIcon} from '@phosphor-icons/react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {StatusDot} from '@deslop/components-web/status-dot'
import {cn} from '@deslop/components-web/utils'

import {spanOf, stripsOf, ticksOf} from '#lib/time.ts'
import type {Strip} from '#lib/time.ts'
import type {PullRequest} from '#services/changes/schema.ts'

const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})

type Span = {readonly end: number; readonly start: number}

function isSelected(pr: PullRequest, selected?: PullRequest) {
	if (selected === undefined) return false
	return selected.repoId === pr.repoId && selected.number === pr.number
}

// The problems a reader must act on, as one phrase for the dot and the row; passing checks and an approval are not problems.
function problemOf(pr: PullRequest) {
	return Array.match(
		[
			...Boolean.match(pr.checks === 'failing', {onFalse: () => [], onTrue: () => ['Checks failing']}),
			...Boolean.match(pr.review === 'changes', {onFalse: () => [], onTrue: () => ['changes requested']})
		],
		{onEmpty: () => undefined, onNonEmpty: problems => Array.join(problems, '; ')}
	)
}

// What a reader hears for the whole row: its number and title, when it opened, merged or last changed, its churn and any problem.
function labelOf(strip: Strip, problem?: string) {
	const pr = strip.pr
	return Array.join(
		[
			`#${pr.number}`,
			pr.title,
			`opened ${date.format(strip.start)}`,
			Option.match(Option.fromUndefinedOr(pr.mergedAt), {
				onNone: () => `updated ${date.format(DateTime.toEpochMillis(DateTime.makeUnsafe(pr.updatedAt)))}`,
				onSome: () => `merged ${date.format(strip.end)}`
			}),
			`+${pr.additions} −${pr.deletions}`,
			...Option.match(Option.fromUndefinedOr(problem), {onNone: () => [], onSome: message => [message]})
		],
		', '
	)
}

function percentOf(at: number, span: Span) {
	return Number.clamp(((at - span.start) / (span.end - span.start)) * 100, {maximum: 100, minimum: 0})
}

// A draft's bar is an outlined placeholder: low fill, dashed edge.
function draftStrokeOf(state: PullRequest['state']) {
	if (state === 'draft') {
		return {stroke: 'currentColor', strokeDasharray: '1.5 1.5', strokeOpacity: 0.55, strokeWidth: 0.6}
	}
	return {}
}

// One pull request's life as a bar from opened to merged or now, across the shared span.
function StripTrack(props: {readonly span: Span; readonly strip: Strip}) {
	const start = percentOf(props.strip.start, props.span)
	return (
		<span className="text-foreground relative h-5 flex-1">
			<svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
				<rect width={100} height={10} fill="currentColor" fillOpacity={0.05} />
				<rect
					x={start}
					y={1}
					width={Number.max(0.6, percentOf(props.strip.end, props.span) - start)}
					height={8}
					fill="currentColor"
					fillOpacity={pipe(
						Match.value(props.strip.pr.state),
						Match.when('merged', () => 0.3),
						Match.when('draft', () => 0.05),
						Match.orElse(() => 0.16)
					)}
					{...draftStrokeOf(props.strip.pr.state)}
				/>
			</svg>
		</span>
	)
}

// One row: its number, title and problem dot at the gutter, then its strip; the row selects the pull request.
function StripRow(props: {
	readonly onSelect: (pr: PullRequest) => void
	readonly selected?: PullRequest
	readonly span: Span
	readonly strip: Strip
}) {
	const pr = props.strip.pr
	const active = isSelected(pr, props.selected)
	const problem = problemOf(pr)
	const label = labelOf(props.strip, problem)
	return (
		<div
			className={cn(
				'flex h-7 w-full items-center gap-3 border-b',
				Boolean.match(active, {onFalse: () => 'hover:bg-accent', onTrue: () => 'bg-selection'})
			)}
		>
			<button
				type="button"
				aria-current={Boolean.match(active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				aria-label={label}
				title={label}
				className="flex h-full w-full items-center gap-3 text-left"
				onClick={() => props.onSelect(pr)}
			>
				<span className="flex w-56 shrink-0 items-center gap-2">
					<span className="text-muted-foreground shrink-0 text-xs tabular-nums">#{pr.number}</span>
					<span className="min-w-0 truncate text-sm">{pr.title}</span>
					{Option.match(Option.fromUndefinedOr(problem), {
						onNone: () => null,
						onSome: message => (
							<span role="img" className="flex shrink-0 items-center" aria-label={message} title={message}>
								<StatusDot status="error" />
							</span>
						)
					})}
				</span>
				<StripTrack span={props.span} strip={props.strip} />
			</button>
		</div>
	)
}

// One strip per pull request, from opened to merged or now, with its number, title and problem at the gutter.
export function FlowView(props: {
	readonly now: number
	readonly pullRequests: readonly PullRequest[]
	readonly selected?: PullRequest
	readonly onSelect: (pr: PullRequest) => void
}) {
	const strips = stripsOf(props.pullRequests, props.now)
	if (Array.isReadonlyArrayEmpty(strips)) {
		return <EmptyState label="No pull requests" icon={<ChartBarHorizontalIcon weight="light" />} />
	}
	const span = spanOf(strips, props.now)
	return (
		<div className="flex flex-col gap-2 p-3">
			<div className="text-muted-foreground flex items-center gap-3 text-xs">
				<span className="w-56 shrink-0" />
				<div className="flex flex-1 justify-between">
					{Array.map(ticksOf(span.start, span.end, 6), tick => (
						<span key={tick} className="tabular-nums">
							{date.format(tick)}
						</span>
					))}
				</div>
			</div>
			{Array.map(strips, strip => (
				<StripRow
					key={`${strip.pr.repoId}#${strip.pr.number}`}
					onSelect={props.onSelect}
					selected={props.selected}
					span={span}
					strip={strip}
				/>
			))}
		</div>
	)
}
