import {Array, Boolean, Option, Order} from 'effect'

import {GridNineIcon} from '@phosphor-icons/react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {cn} from '@deslop/components-web/utils'

import {areaOf} from '#lib/areas.ts'
import {couplingOf} from '#lib/coupling.ts'
import type {PullRequest} from '#services/changes/schema.ts'

const ROW_CLASS = 'flex items-stretch gap-px'
const CELLS_CLASS = 'flex flex-1 gap-px'
const GUTTER_CLASS = 'w-40 shrink-0'
const CELL_CLASS = 'aspect-square min-w-0 flex-1 border-r border-b'

function opacityOf(score: number, maxScore: number) {
	return 0.12 + 0.75 * Boolean.match(maxScore === 0, {onFalse: () => score / maxScore, onTrue: () => 0})
}

// The matrix is a drawn grid; a cell is a bare selection target, not a themed control.
function Cell(props: {fill: number; label: string; onSelect: () => void}) {
	return (
		<button
			type="button"
			className={cn('flex items-center justify-center', CELL_CLASS, 'text-foreground')}
			title={props.label}
			aria-label={props.label}
			onClick={props.onSelect}
		>
			<svg viewBox="0 0 10 10" className="size-full" aria-hidden>
				<rect width={10} height={10} fill="currentColor" fillOpacity={props.fill} />
			</svg>
		</button>
	)
}

function BlankCell() {
	return <span className={CELL_CLASS} />
}

export function CoupleView(props: {
	readonly pullRequests: readonly PullRequest[]
	readonly selected?: PullRequest
	readonly onSelect: (pr: PullRequest) => void
}) {
	const matrix = couplingOf(props.pullRequests, 12)
	if (Array.length(matrix.areas) < 2) {
		return <EmptyState label="Not enough areas to couple" icon={<GridNineIcon weight="light" />} />
	}
	function selectPair(area: string, column: string) {
		Option.map(
			Array.findFirst(
				Array.sort(
					props.pullRequests,
					Order.mapInput(Order.flip(Order.String), (pr: PullRequest) => pr.updatedAt)
				),
				pr => Array.every([area, column], touched => Array.some(pr.files, file => areaOf(file.path) === touched))
			),
			pr => props.onSelect(pr)
		)
	}
	return (
		<div className="flex flex-col gap-3 p-3">
			<div className={ROW_CLASS}>
				<span className={GUTTER_CLASS} />
				<div className={CELLS_CLASS}>
					{Array.map(matrix.areas, area => (
						<span key={area} className="text-muted-foreground min-w-0 flex-1 truncate text-center text-xs" title={area}>
							{area}
						</span>
					))}
				</div>
			</div>
			{Array.map(matrix.areas, (area, row) => (
				<div key={area} className={ROW_CLASS}>
					<span
						className={cn(
							GUTTER_CLASS,
							'truncate text-xs',
							Boolean.match(
								Option.exists(Option.fromUndefinedOr(props.selected), pr =>
									Array.some(pr.files, file => areaOf(file.path) === area)
								),
								{onFalse: () => 'text-muted-foreground', onTrue: () => 'text-foreground'}
							)
						)}
						title={area}
					>
						{area}
					</span>
					<div className={CELLS_CLASS}>
						{Array.map(matrix.areas, (column, index) =>
							Option.match(
								Option.filter(
									Array.findFirst(
										matrix.cells,
										cell => (cell.a === area && cell.b === column) || (cell.a === column && cell.b === area)
									),
									() => row < index
								),
								{
									onNone: () => <BlankCell key={column} />,
									onSome: cell => (
										<Cell
											key={column}
											fill={opacityOf(cell.score, matrix.maxScore)}
											label={`${area} and ${column}: ${cell.count} shared pull requests`}
											onSelect={() => selectPair(area, column)}
										/>
									)
								}
							)
						)}
					</div>
				</div>
			))}
			<p className="text-muted-foreground text-xs">
				Darker cells share more of the pull requests that touch either area.
			</p>
		</div>
	)
}
