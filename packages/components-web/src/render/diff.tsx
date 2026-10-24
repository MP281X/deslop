import {Array, Boolean, Match, Number, Option, Predicate, String, pipe} from 'effect'

import type {AnnotationSide} from '@pierre/diffs'
import {getSingularPatch, setLanguageOverride} from '@pierre/diffs'
import {File, FileDiff} from '@pierre/diffs/react'
import {useHotkey} from '@tanstack/react-hotkeys'
import {CircleCheckIcon, CopyIcon, MessageSquareTextIcon} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {Markdown} from './markdown.tsx'

import {GithubLight} from '#components/svgs/githubLight.tsx'
import {Button} from '#components/ui/button.tsx'
import {Spinner} from '#components/ui/spinner.tsx'
import {HIGHLIGHT_THEMES, resolveLanguage} from '#lib/shiki.ts'

const DIFF_CSS = `
	:host,
	pre {
		--diffs-bg: var(--background) !important;
		--diffs-bg-buffer-override: var(--background) !important;
		--diffs-bg-context-override: var(--background) !important;
		--diffs-bg-hover-override: color-mix(in oklab, var(--muted) 70%, transparent) !important;
		--diffs-bg-separator-override: var(--muted) !important;
		--diffs-fg: var(--foreground) !important;
		--diffs-fg-number-override: var(--muted-foreground) !important;
		font-family: 'JetBrainsMono Nerd Font Mono', 'JetBrains Mono Variable', monospace !important;
		font-size: inherit !important;
		letter-spacing: 0 !important;
		line-height: inherit !important;
		user-select: text !important;
	}

	pre {
		background-color: transparent !important;
	}

	*,
	::before,
	::after {
		border-radius: 0 !important;
		user-select: text !important;
	}

	[data-diff],
	[data-file],
	[data-separator],
	[data-line],
	[data-line] *,
	[data-line-annotation],
	[data-annotation-content] {
		border-radius: 0 !important;
	}

	[data-diff] [data-line][data-line-type='context'],
	[data-diff] [data-line][data-line-type='context-expanded'],
	[data-file] [data-line] {
		background-color: var(--background) !important;
		color: var(--foreground) !important;
	}

	[data-diff] [data-column-number][data-line-type='context'],
	[data-diff] [data-column-number][data-line-type='context-expanded'],
	[data-file] [data-column-number] {
		background-color: var(--background) !important;
		color: var(--muted-foreground) !important;
	}

	[data-separator] {
		background-color: var(--muted) !important;
		color: var(--muted-foreground) !important;
	}
`

export declare namespace PatchDiff {
	export type Comment = {
		filePath: string
		lineNumber: number
		side?: AnnotationSide
		body: string
		resolving?: boolean
		source?: 'github' | 'local'
		threadId?: string
	}
}

function sameDiffLine(
	left: {filePath: string; lineNumber: number; side?: AnnotationSide},
	right: {filePath: string; lineNumber: number; side?: AnnotationSide}
) {
	return (
		left.filePath === right.filePath &&
		left.lineNumber === right.lineNumber &&
		(left.side === 'deletions') === (right.side === 'deletions')
	)
}

export function formatCopiedComment(comment: {
	body: string
	filePath: string
	lineNumber: number
	side?: AnnotationSide
}) {
	return `# Review comments\n\n## ${comment.filePath}\n\n${Boolean.match(comment.side === 'deletions', {onFalse: () => 'line', onTrue: () => 'deleted'})}:${comment.lineNumber}: ${comment.body}`
}

function captureScrollAnchor(container: HTMLElement, clientY: number) {
	const lineElement = pipe(
		Array.fromIterable(
			container
				.querySelector('diffs-container')
				?.shadowRoot?.querySelectorAll<HTMLElement>('[data-line][data-line-type]') ?? []
		),
		Array.findFirst(element => {
			const rect = element.getBoundingClientRect()
			return clientY >= rect.top && clientY <= rect.bottom
		}),
		Option.getOrUndefined
	)

	if (lineElement === undefined) return

	if (Predicate.isUndefined(lineElement.dataset['line']) || String.isEmpty(lineElement.dataset['line'])) return

	return {
		clientY,
		lineNumber: lineElement.dataset['line'],
		offsetWithinLine: clientY - lineElement.getBoundingClientRect().top,
		scrollTop: container.scrollTop
	}
}

function restoreScrollAnchor(
	container: HTMLElement,
	anchor: {clientY: number; offsetWithinLine: number; lineNumber: string; scrollTop: number},
	mode: 'diff' | 'file'
) {
	const line = `[data-line="${CSS.escape(anchor.lineNumber)}"]`
	const targetLine = container
		.querySelector('diffs-container')
		?.shadowRoot?.querySelector(
			Boolean.match(mode === 'diff', {
				onFalse: () => line,
				onTrue: () => `${line}:not([data-line-type="change-deletion"])`
			})
		)

	if (!(targetLine instanceof HTMLElement)) {
		container.scrollTo({behavior: 'instant', top: anchor.scrollTop})
		return true
	}

	container.scrollTo({
		behavior: 'instant',
		top: container.scrollTop + targetLine.getBoundingClientRect().top - (anchor.clientY - anchor.offsetWithinLine)
	})
	return true
}

function SourceIcon(props: {source: PatchDiff.Comment['source']}) {
	if (props.source === 'github') return <GithubLight className="size-3 shrink-0" />
	return <MessageSquareTextIcon className="size-3 shrink-0" />
}

function CommentAnnotation(props: {
	comment: PatchDiff.Comment
	isDraft?: boolean
	onSaveComment?: (comment: PatchDiff.Comment) => void
	onResolveComment?: (comment: PatchDiff.Comment) => void
	onCloseDraft?: () => void
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const [editing, setEditing] = useState(() => String.isEmpty(props.comment.body))

	useEffect(() => {
		if (!editing) return

		const animationFrame = requestAnimationFrame(() => {
			inputRef.current?.focus()
		})

		return () => {
			cancelAnimationFrame(animationFrame)
		}
	}, [editing])

	function saveDraft() {
		const body = inputRef.current?.value ?? props.comment.body
		if (String.isEmpty(String.trim(body))) {
			if (props.isDraft === true) {
				props.onCloseDraft?.()
				return
			}

			props.onResolveComment?.({...props.comment, body})
			setEditing(false)
			props.onCloseDraft?.()
			return
		}

		props.onSaveComment?.({...props.comment, body: String.trim(body)})
		setEditing(false)
		props.onCloseDraft?.()
	}

	if (editing) {
		return (
			// oxlint-disable-next-line shadcn/no-arbitrary-values -- no grid-cols scale step gives a shrinkable body column between two auto columns.
			<div className="border-border/70 bg-muted/70 text-foreground box-border grid w-full max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-y p-2">
				<div className="border-border bg-background text-muted-foreground inline-flex shrink-0 border p-1">
					<SourceIcon source={props.comment.source} />
				</div>
				<div className="min-w-0">
					<textarea
						ref={inputRef}
						defaultValue={props.comment.body}
						placeholder="Add comment"
						aria-label="Comment"
						className="block min-h-16 w-full resize-y border-0 bg-transparent p-0 text-inherit outline-none"
						onClick={event => {
							event.stopPropagation()
						}}
						onKeyDown={event => {
							if (event.nativeEvent.isComposing) return
							if (event.key === 'Escape') {
								event.preventDefault()

								if (props.isDraft === true) props.onCloseDraft?.()
								else setEditing(false)
							}

							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault()
								saveDraft()
							}
						}}
					/>
				</div>
				<div />
			</div>
		)
	}

	return (
		// oxlint-disable-next-line shadcn/no-arbitrary-values -- no grid-cols scale step gives a shrinkable body column between two auto columns.
		<div className="border-border/70 bg-muted/70 text-foreground box-border grid w-full max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-y p-2">
			<div className="border-border bg-background text-muted-foreground inline-flex shrink-0 border p-1">
				<SourceIcon source={props.comment.source} />
			</div>
			<button
				type="button"
				className="min-w-0 bg-transparent p-0 text-left"
				onClick={event => {
					event.stopPropagation()
					if (props.comment.source !== 'github') setEditing(true)
				}}
			>
				<Markdown className="text-inherit">{props.comment.body}</Markdown>
			</button>
			<div className="border-border bg-background text-muted-foreground inline-flex shrink-0 border text-xs">
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Copy comment"
					title="Copy comment"
					onClick={async event => {
						event.stopPropagation()
						await navigator.clipboard.writeText(formatCopiedComment(props.comment))
					}}
				>
					<CopyIcon className="size-3" />
				</Button>
				{props.onResolveComment !== undefined && (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Resolve comment"
						title="Resolve comment"
						disabled={props.comment.resolving}
						onClick={event => {
							event.stopPropagation()
							props.onResolveComment?.(props.comment)
						}}
					>
						{Boolean.match(props.comment.resolving === true, {
							onFalse: () => <CircleCheckIcon className="size-3" />,
							onTrue: () => <Spinner className="size-3" />
						})}
					</Button>
				)}
			</div>
		</div>
	)
}

export function PatchDiff(props: {
	filePath: string
	fileContent?: string
	patch?: string
	comments?: PatchDiff.Comment[]
	onSaveComment?: (comment: PatchDiff.Comment) => void
	onResolveComment?: (comment: PatchDiff.Comment) => void
}) {
	const containerRef = useRef<HTMLElement>(null)
	const pointerClientYRef = useRef<number>(null)
	const scrollAnchorRef = useRef<NonNullable<ReturnType<typeof captureScrollAnchor>>>(null)
	const [draftComment, setDraftComment] = useState<PatchDiff.Comment>()
	const patch = pipe(Option.fromUndefinedOr(props.patch), Option.filter(String.isNonEmpty), Option.getOrUndefined)

	const modeKey = `${props.filePath}\u0000${patch ?? ''}\u0000${Boolean.match(Predicate.isString(props.fileContent), {onFalse: () => 'pending', onTrue: () => 'file'})}`
	const preferredMode = Boolean.match(Predicate.isString(patch), {
		onFalse: () => 'file' as const,
		onTrue: () => 'diff' as const
	})
	const [modeState, setModeState] = useState(() => ({key: modeKey, mode: preferredMode}))
	const requestedMode = Boolean.match(modeState.key === modeKey, {
		onFalse: () => preferredMode,
		onTrue: () => modeState.mode
	})
	function resolveMode() {
		if (requestedMode === 'diff' && Predicate.isUndefined(patch)) return 'file'
		if (requestedMode === 'file' && Predicate.isUndefined(props.fileContent) && Predicate.isString(patch)) return 'diff'
		return requestedMode
	}
	const mode = resolveMode()
	const language = resolveLanguage(props.filePath)
	const fileDiff = pipe(
		Option.fromUndefinedOr(patch),
		Option.map(text => setLanguageOverride(getSingularPatch(text), language))
	)
	const comments = props.comments ?? []
	const draft = Option.fromUndefinedOr(draftComment)
	const commentsWithDraft = Array.appendAll(comments, Option.toArray(draft))

	useEffect(() => {
		containerRef.current?.focus()
	}, [mode, props.filePath, props.patch, props.fileContent])

	useLayoutEffect(() => {
		if (Predicate.isNull(containerRef.current) || Predicate.isNull(scrollAnchorRef.current)) return
		if (restoreScrollAnchor(containerRef.current, scrollAnchorRef.current, mode)) scrollAnchorRef.current = null
	}, [mode, props.fileContent])

	function toggleMode() {
		if (Predicate.isUndefined(patch) || Predicate.isUndefined(props.fileContent)) return
		if (Predicate.isNull(containerRef.current)) return

		const rect = containerRef.current.getBoundingClientRect()
		const clientY = pipe(
			Option.fromNullOr(pointerClientYRef.current),
			Option.match({
				onNone: () => rect.top + rect.height / 2,
				onSome: Number.clamp({maximum: rect.bottom, minimum: rect.top})
			})
		)
		scrollAnchorRef.current = captureScrollAnchor(containerRef.current, clientY) ?? null
		setModeState(current => ({
			key: modeKey,
			mode: Boolean.match(current.key === modeKey && current.mode === 'file', {
				onFalse: () => 'file' as const,
				onTrue: () => 'diff' as const
			})
		}))
	}

	useHotkey(
		'Tab',
		event => {
			if (Predicate.isUndefined(patch) || Predicate.isUndefined(props.fileContent)) return
			event.preventDefault()
			toggleMode()
		},
		{preventDefault: false, target: containerRef}
	)

	function openComment(line: {lineNumber: number; side?: AnnotationSide}) {
		if (props.onSaveComment === undefined) return
		const location = {filePath: props.filePath, lineNumber: line.lineNumber, side: line.side ?? 'additions'}

		if (Option.isSome(draft)) return

		if (!Array.some(comments, current => sameDiffLine(current, location))) {
			setDraftComment({
				body: '',
				filePath: props.filePath,
				lineNumber: line.lineNumber,
				...Boolean.match(line.side === 'deletions', {onFalse: () => ({}), onTrue: () => ({side: 'deletions' as const})})
			})
		}
	}

	const content = pipe(
		Match.value({fileContent: props.fileContent, fileDiff, mode, patch}),
		Match.when(
			value => value.mode === 'diff' && Option.isSome(value.fileDiff),
			value => (
				<FileDiff<PatchDiff.Comment>
					key={value.patch}
					fileDiff={Option.getOrThrow(value.fileDiff)}
					options={{
						diffIndicators: 'bars',
						diffStyle: 'unified',
						disableBackground: false,
						disableFileHeader: true,
						disableLineNumbers: false,
						lineDiffType: 'word-alt',
						onLineNumberClick: line => {
							openComment({lineNumber: line.lineNumber, side: line.annotationSide})
						},
						overflow: 'scroll',
						theme: HIGHLIGHT_THEMES,
						themeType: 'system',
						unsafeCSS: DIFF_CSS
					}}
					lineAnnotations={Array.map(commentsWithDraft, comment => ({
						lineNumber: comment.lineNumber,
						metadata: comment,
						side: comment.side ?? 'additions'
					}))}
					renderAnnotation={annotation => (
						<CommentAnnotation
							comment={annotation.metadata}
							isDraft={Option.exists(draft, current => sameDiffLine(annotation.metadata, current))}
							{...Option.match(Option.fromUndefinedOr(props.onSaveComment), {
								onNone: () => ({}),
								onSome: onSaveComment => ({onSaveComment})
							})}
							{...Option.match(Option.fromUndefinedOr(props.onResolveComment), {
								onNone: () => ({}),
								onSome: onResolveComment => ({onResolveComment})
							})}
							onCloseDraft={() => {
								setDraftComment(undefined)
							}}
						/>
					)}
				/>
			)
		),
		Match.when(
			value => Predicate.isString(value.fileContent) || Predicate.isString(value.patch),
			value => (
				<File<PatchDiff.Comment>
					key={props.filePath}
					file={{contents: value.fileContent ?? '', lang: language, name: props.filePath}}
					options={{
						disableFileHeader: true,
						disableLineNumbers: false,
						onLineNumberClick: line => {
							openComment({lineNumber: line.lineNumber})
						},
						overflow: 'scroll',
						theme: HIGHLIGHT_THEMES,
						themeType: 'system',
						unsafeCSS: DIFF_CSS
					}}
					lineAnnotations={Array.map(
						Array.filter(commentsWithDraft, comment => comment.side !== 'deletions'),
						comment => ({lineNumber: comment.lineNumber, metadata: comment})
					)}
					renderAnnotation={annotation => (
						<CommentAnnotation
							comment={annotation.metadata}
							isDraft={Option.exists(draft, current => sameDiffLine(annotation.metadata, current))}
							{...Option.match(Option.fromUndefinedOr(props.onSaveComment), {
								onNone: () => ({}),
								onSome: onSaveComment => ({onSaveComment})
							})}
							{...Option.match(Option.fromUndefinedOr(props.onResolveComment), {
								onNone: () => ({}),
								onSome: onResolveComment => ({onResolveComment})
							})}
							onCloseDraft={() => {
								setDraftComment(undefined)
							}}
						/>
					)}
				/>
			)
		),
		Match.orElse(() => (
			<div className="text-muted-foreground flex h-full items-center justify-center text-sm">
				<Spinner variant="subtle" className="mr-2 size-3" />
				Loading file
			</div>
		))
	)

	return (
		<section
			ref={containerRef}
			tabIndex={-1}
			aria-label="Diff viewer"
			className="bg-background block h-full min-h-0 w-full overflow-auto rounded-none outline-none select-text"
			onPointerMoveCapture={event => {
				pointerClientYRef.current = event.clientY
			}}
			onPointerDownCapture={event => {
				pointerClientYRef.current = event.clientY

				if (!(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement)) {
					event.currentTarget.focus()
				}
			}}
		>
			{content}
		</section>
	)
}
