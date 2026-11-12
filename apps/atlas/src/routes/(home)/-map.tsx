import {Array, Boolean, Number, Option, Order} from 'effect'

import {MapTrifoldIcon} from '@phosphor-icons/react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {StatusDot} from '@deslop/components-web/status-dot'
import {cn} from '@deslop/components-web/utils'

import {areaOf, churnByArea} from '#lib/areas.ts'
import type {AreaChurn} from '#lib/areas.ts'
import {isSamePullRequest, problemOf} from '#lib/pull-request.ts'
import {squarify} from '#lib/treemap.ts'
import type {PullRequest} from '#services/changes/schema.ts'

const STATE_LABELS: Record<PullRequest['state'], string> = {draft: 'Draft', merged: 'Merged', open: 'Open'}

// In flight first, then the most recently touched; a map's first panels are the ones still moving.
const PANEL_ORDER = Order.combine(
	Order.mapInput(Order.Number, (pr: PullRequest) =>
		Boolean.match(pr.state === 'merged', {onFalse: () => 0, onTrue: () => 1})
	),
	Order.flip(Order.mapInput(Order.String, (pr: PullRequest) => pr.updatedAt))
)

// What a reader hears for the whole panel: its name, both sides of its churn, its state and any problem.
function labelOf(pr: PullRequest, problem?: string) {
	return Array.join(
		[
			`#${pr.number} ${pr.title}`,
			`+${pr.additions} −${pr.deletions}`,
			STATE_LABELS[pr.state],
			...Option.match(Option.fromUndefinedOr(problem), {onNone: () => [], onSome: message => [message]})
		],
		', '
	)
}

// A tile's tooltip: its area and both sides of the churn it holds.
function areaTitle(rows: readonly AreaChurn[], area: string) {
	return Option.match(
		Array.findFirst(rows, row => row.area === area),
		{onNone: () => `${area} +0 −0`, onSome: row => `${row.area} +${row.additions} −${row.deletions}`}
	)
}

// One pull request's churn as one tile per area; with no churn, its first file's area keeps the one tile.
function AreaMap(props: {files: PullRequest['files']; rows: readonly AreaChurn[]}) {
	const items = Array.map(props.rows, row => ({key: row.area, value: row.additions + row.deletions}))
	const layout = squarify(
		Boolean.match(
			Array.some(items, item => item.value > 0),
			{
				onFalse: () => [
					{
						key: Option.match(Array.head(props.files), {onNone: () => '(root)', onSome: file => areaOf(file.path)}),
						value: 1
					}
				],
				onTrue: () => items
			}
		),
		100,
		34
	)
	return (
		<svg viewBox="0 0 100 34" preserveAspectRatio="none" className="text-foreground h-24 w-full" aria-hidden>
			{Array.map(layout, tile => (
				<rect
					key={tile.key}
					x={tile.x}
					y={tile.y}
					width={tile.width}
					height={tile.height}
					fill="currentColor"
					fillOpacity={
						0.08 + (tile.value / Array.reduce(layout, 0, (largest, other) => Number.max(largest, other.value))) * 0.54
					}
					stroke="currentColor"
					strokeOpacity={0.35}
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				>
					<title>{areaTitle(props.rows, tile.key)}</title>
				</rect>
			))}
		</svg>
	)
}

// One pull request's small multiple: its area treemap, its name and churn, and a dot when checks or review need a person.
function MapPanel(props: {onSelect: (pr: PullRequest) => void; pr: PullRequest; selected?: PullRequest}) {
	const churn = churnByArea(props.pr.files)
	const problem = problemOf(props.pr)
	const selected = isSamePullRequest(props.pr, props.selected)
	return (
		<div
			className={cn(
				'bg-surface border p-2',
				Boolean.match(selected, {onFalse: () => 'border-border', onTrue: () => 'border-foreground'})
			)}
		>
			<button
				type="button"
				aria-current={Boolean.match(selected, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				aria-label={labelOf(props.pr, problem)}
				title={Array.join(
					[
						props.pr.title,
						...Array.map(Array.take(churn, 3), row => `${row.area} +${row.additions} −${row.deletions}`)
					],
					' · '
				)}
				className="flex w-full flex-col gap-2 text-left"
				onClick={() => props.onSelect(props.pr)}
			>
				{Boolean.match(Array.isReadonlyArrayEmpty(props.pr.files), {
					onFalse: () => <AreaMap files={props.pr.files} rows={churn} />,
					onTrue: () => <div className="bg-muted h-24 w-full" />
				})}
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-sm">{props.pr.title}</span>
					{Option.match(Option.fromUndefinedOr(problem), {
						onNone: () => null,
						onSome: message => (
							<span role="img" className="flex shrink-0 items-center" aria-label={message} title={message}>
								<StatusDot status="error" />
							</span>
						)
					})}
				</span>
				{Array.match(churn, {
					onEmpty: () => null,
					onNonEmpty: rows => (
						<span className="text-muted-foreground truncate text-xs">
							{Array.join(
								Array.map(Array.take(rows, 3), row => row.area),
								' · '
							)}
						</span>
					)
				})}
				<span className="text-muted-foreground text-xs">
					{Array.join(
						[
							`#${props.pr.number}`,
							`+${props.pr.additions}`,
							`−${props.pr.deletions}`,
							...Boolean.match(props.pr.state === 'open', {
								onFalse: () => [STATE_LABELS[props.pr.state]],
								onTrue: () => []
							})
						],
						' · '
					)}
				</span>
			</button>
		</div>
	)
}

export function MapView(props: {
	readonly pullRequests: readonly PullRequest[]
	readonly selected?: PullRequest
	readonly onSelect: (pr: PullRequest) => void
}) {
	return Array.match(Array.sort(props.pullRequests, PANEL_ORDER), {
		onEmpty: () => <EmptyState label="No pull requests" icon={<MapTrifoldIcon weight="light" />} />,
		onNonEmpty: pullRequests => (
			<div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
				{Array.map(pullRequests, pr => (
					<MapPanel key={`${pr.repoId}#${pr.number}`} onSelect={props.onSelect} pr={pr} selected={props.selected} />
				))}
			</div>
		)
	})
}
