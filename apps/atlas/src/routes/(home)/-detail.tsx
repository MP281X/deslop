import {Array, Boolean, DateTime, Match, Number, Option, Order, pipe} from 'effect'

import {ArrowSquareOutIcon, CursorClickIcon} from '@phosphor-icons/react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {StatusDot} from '@deslop/components-web/status-dot'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'

import type {PullRequest} from '#services/changes/schema.ts'

const date = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'})
const count = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})

// The bar under a file: its place in the pull request's largest file, then its additions and deletions.
function FileRow(props: {file: PullRequest['files'][number]; largest: number}) {
	const total = props.file.additions + props.file.deletions
	const additions = (props.file.additions / props.largest) * 100
	const deletions = (props.file.deletions / props.largest) * 100
	return (
		<div role="listitem" className="flex flex-col gap-1 border-b px-3 py-2">
			<div className="flex min-w-0 items-center justify-between gap-3">
				<span className="min-w-0 truncate text-xs" title={`${props.file.state}: ${props.file.path}`}>
					{props.file.path}
				</span>
				<span
					className="text-muted-foreground shrink-0 text-xs tabular-nums"
					title={`${count.format(total)} changed lines`}
				>
					+{count.format(props.file.additions)} −{count.format(props.file.deletions)}
				</span>
			</div>
			<svg viewBox="0 0 100 4" preserveAspectRatio="none" className="text-foreground h-1 w-full" aria-hidden>
				<rect width={100} height={4} fill="currentColor" fillOpacity={0.06} />
				<rect width={additions} height={4} fill="currentColor" fillOpacity={0.5} />
				<rect x={additions} width={deletions} height={4} fill="currentColor" fillOpacity={0.18} />
			</svg>
		</div>
	)
}

// The problem the bar's dot marks: a failing check or changes requested; a passing check or an approval stays unlabelled.
function Problem(props: {label: string}) {
	return (
		<span className="text-destructive flex items-center gap-1.5">
			<StatusDot status="error" />
			{props.label}
		</span>
	)
}

// The chosen pull request: its name, who and when, its churn and problems, then every file by churn.
export function DetailPane(props: {pr?: PullRequest}) {
	if (props.pr === undefined) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<EmptyState label="Select a pull request" icon={<CursorClickIcon weight="light" />} />
			</div>
		)
	}
	const pr = props.pr
	const files = Array.sort(
		pr.files,
		Order.flip(Order.mapInput(Order.Number, (file: PullRequest['files'][number]) => file.additions + file.deletions))
	)
	const largest = Array.reduce(files, 1, (size, file) => Number.max(size, file.additions + file.deletions))
	return (
		<section aria-label="Pull request" className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b p-3">
				<div className="flex items-start justify-between gap-3">
					<span className="min-w-0 text-sm">
						<span className="text-muted-foreground tabular-nums">#{pr.number} </span>
						{pr.title}
					</span>
					<a
						href={pr.url}
						target="_blank"
						rel="noreferrer"
						className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs"
					>
						Open
						<ArrowSquareOutIcon aria-hidden className="size-3.5" />
					</a>
				</div>
				<div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
					<span>{pr.author}</span>
					<span aria-hidden>·</span>
					<span>opened {date.format(DateTime.toEpochMillis(DateTime.makeUnsafe(pr.createdAt)))}</span>
					{Boolean.match(pr.state === 'open', {
						onFalse: () => (
							<>
								<span aria-hidden>·</span>
								<span>
									{pipe(
										Match.value(pr.state),
										Match.when('merged', () => 'Merged'),
										Match.orElse(() => 'Draft')
									)}
								</span>
							</>
						),
						onTrue: () => null
					})}
					{Boolean.match(pr.checks === 'failing', {
						onFalse: () => null,
						onTrue: () => <Problem label="Checks failing" />
					})}
					{Boolean.match(pr.review === 'changes', {
						onFalse: () => null,
						onTrue: () => <Problem label="Changes requested" />
					})}
				</div>
				<div className="flex flex-wrap items-center gap-x-2 text-xs">
					<span className="tabular-nums">+{count.format(pr.additions)}</span>
					<span className="text-muted-foreground tabular-nums">−{count.format(pr.deletions)}</span>
					<span className="text-muted-foreground" aria-hidden>
						·
					</span>
					<span className="text-muted-foreground">
						{count.format(pr.files.length)}{' '}
						{Boolean.match(pr.files.length === 1, {onFalse: () => 'files', onTrue: () => 'file'})}
					</span>
					{Option.match(Option.fromUndefinedOr(pr.mergedAt), {
						onNone: () => null,
						onSome: mergedAt => (
							<>
								<span className="text-muted-foreground" aria-hidden>
									·
								</span>
								<span className="text-muted-foreground">
									merged {date.format(DateTime.toEpochMillis(DateTime.makeUnsafe(mergedAt)))}
								</span>
							</>
						)
					})}
				</div>
			</div>
			{Boolean.match(Array.isReadonlyArrayEmpty(files), {
				onFalse: () => (
					<ScrollArea className="min-h-0 flex-1">
						<div role="list">
							{Array.map(files, file => (
								<FileRow key={`${file.path} ${file.state}`} file={file} largest={largest} />
							))}
						</div>
					</ScrollArea>
				),
				onTrue: () => <EmptyState label="No files reported" icon={<CursorClickIcon weight="light" />} />
			})}
		</section>
	)
}
