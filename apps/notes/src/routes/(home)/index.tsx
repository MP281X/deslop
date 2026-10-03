import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Exit, Option, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {useEffect, useRef, useState, useSyncExternalStore} from 'react'

import {findNotes, notesAtom, parseTags, RpcClient} from '#lib/utils.ts'
import {NotesState} from '#services/notes/schema.ts'
import type {Note} from '#services/notes/schema.ts'
import {
	ChevronDown,
	ExternalLink,
	ArrowUp,
	Check,
	ClipboardPaste,
	Tag,
	Pencil,
	Plus,
	Search,
	Trash2,
	X
} from '@deslop/components/icons'
import {Button} from '@deslop/components/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components/ui/collapsible'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@deslop/components/ui/dialog'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components/ui/empty'
import {Input} from '@deslop/components/ui/input'
import {Label} from '@deslop/components/ui/label'
import {Popover, PopoverContent, PopoverTrigger} from '@deslop/components/ui/popover'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components/ui/select'
import {Spinner} from '@deslop/components/ui/spinner'
import {Textarea} from '@deslop/components/ui/textarea'

export const Route = createFileRoute('/(home)/')({component: Home})

function subscribeOnline(callback: () => void) {
	addEventListener('online', callback)
	addEventListener('offline', callback)
	return () => {
		removeEventListener('online', callback)
		removeEventListener('offline', callback)
	}
}

function initialDraft() {
	const params = new URLSearchParams(location.search)
	const shared = pipe(
		['title', 'text', 'url'],
		Array.map(key => params.get(key) ?? ''),
		Array.filter(String.isNonEmpty),
		Array.dedupe,
		Array.join('\n')
	)
	try {
		const saved = localStorage.getItem('notes.draft') ?? ''
		if (String.isEmpty(shared) || saved === shared) return {sharedWithDraft: false, storageIssue: '', text: saved}
		return {
			sharedWithDraft: String.isNonEmpty(saved),
			storageIssue: '',
			text: pipe([saved, shared], Array.filter(String.isNonEmpty), Array.join('\n'))
		}
	} catch {
		return {
			sharedWithDraft: false,
			storageIssue: 'This browser cannot keep drafts. Keep this page open until you save.',
			text: shared
		}
	}
}

function persistDraft(text: string) {
	try {
		localStorage.setItem('notes.draft', text)
		const url = new URL(location.href)
		for (const key of ['title', 'text', 'url']) url.searchParams.delete(key)
		history.replaceState(history.state, '', url)
		return {storageIssue: '', text}
	} catch {
		return {storageIssue: 'This browser cannot keep drafts. Keep this page open until you save.', text}
	}
}

function Home() {
	const result = useAtomValue(notesAtom)
	const state = pipe(
		AsyncResult.value(result),
		Option.getOrElse(() => NotesState.make({aiReserved: 0, notes: []}))
	)
	const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
	const [query, setQuery] = useState('')
	const [tag, setTag] = useState('')
	const notes = findNotes(state.notes, {query, tag})
	const tagOptions = pipe(
		state.notes,
		Array.flatMap(note => note.tags),
		Array.append(tag),
		Array.dedupe,
		Array.filter(String.isNonEmpty),
		Array.sort(String.Order),
		Array.prepend(''),
		Array.map(value => ({label: String.isEmpty(value) ? 'All tags' : `#${value}`, value}))
	)

	const capture = <Capture online={online} />

	return (
		<div role="main" aria-label="Notes" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 p-3">
			<h1 className="sr-only">Notes</h1>
			{capture}
			<section aria-label="Saved notes" className="flex min-h-0 flex-1 flex-col gap-2">
				<div className="flex shrink-0 items-center gap-2">
					<div className="relative min-w-0 flex-1">
						<Search className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 size-4" />
						<Input
							className="h-11 pl-9"
							aria-label="Search notes"
							type="search"
							placeholder="Search"
							value={query}
							onChange={event => setQuery(event.target.value)}
						/>
					</div>
					<Popover>
						<PopoverTrigger
							render={
								<Button
									variant={String.isNonEmpty(tag) ? 'secondary' : 'outline'}
									size="icon-lg"
									className="size-11"
									aria-label="Tags"
								/>
							}
						>
							<Tag className="size-4" />
						</PopoverTrigger>
						<PopoverContent align="end" className="w-64">
							<Label htmlFor="tag-filter">Tag</Label>
							<Select value={tag} onValueChange={value => setTag(value ?? '')} items={tagOptions}>
								<SelectTrigger id="tag-filter" className="min-h-11 w-full min-w-0">
									<SelectValue className="min-w-0 truncate" />
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false} className="max-h-64">
									{Array.map(tagOptions, item => (
										<SelectItem key={item.value} value={item.value} className="min-h-11" aria-label={item.label}>
											<span className="max-w-52 truncate">{item.label}</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<About reserved={state.aiReserved} />
						</PopoverContent>
					</Popover>
				</div>
				{String.isNonEmpty(tag) && (
					<Button
						variant="secondary"
						className="min-h-11 max-w-full shrink-0 self-start"
						aria-label={`Clear tag filter ${tag}`}
						onClick={() => setTag('')}
					>
						<span className="max-w-40 truncate">#{tag}</span>
						<X className="size-4" />
					</Button>
				)}
				{AsyncResult.isInitial(result) && (
					<p role="status" className="text-muted-foreground text-xs">
						Connecting…
					</p>
				)}
				{AsyncResult.isFailure(result) && online && (
					<p role="status" className="text-muted-foreground text-xs">
						Reconnecting…
					</p>
				)}
				<div>
					{AsyncResult.isSuccess(result) && Array.isReadonlyArrayEmpty(notes) && (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>{Array.isReadonlyArrayEmpty(state.notes) ? 'No notes yet' : 'No matches'}</EmptyTitle>
							</EmptyHeader>
						</Empty>
					)}
					<div className="divide-y">
						{Array.map(notes, note => (
							<NoteRow key={note.id} note={note} onTag={value => setTag(value)} />
						))}
					</div>
				</div>
			</section>
		</div>
	)
}

function About(props: {reserved: NotesState['aiReserved']}) {
	return (
		<Dialog>
			<DialogTrigger render={<Button variant="outline" className="mt-2 min-h-11 w-full" />}>About Notes</DialogTrigger>
			<DialogContent showCloseButton={false} className="max-h-4/5 overflow-y-auto">
				<DialogClose
					render={<Button className="size-11 justify-self-end" variant="outline" size="icon-lg" aria-label="Close" />}
				>
					<X className="size-4" />
				</DialogClose>
				<DialogHeader>
					<DialogTitle>Notes</DialogTitle>
					<DialogDescription>
						Private through Tailscale. Saved text goes through OpenRouter for AI organization.
					</DialogDescription>
				</DialogHeader>
				<p className="text-sm">
					On iPhone, use Safari → Share → Add to Home Screen. Clipboard access may require an extra confirmation. If
					access is denied, touch and hold the field, then choose Paste. Native iPhone sharing is not supported.
				</p>
				<p className="text-sm">
					AI reads up to 10,000 characters once per new note. Search is free. TikTok captions are not transcripts.
					Blocked sources stay saved as links.
				</p>
				<p className="text-sm">
					AI allowance reserved: $
					{new Intl.NumberFormat('en-US', {maximumFractionDigits: 3, minimumFractionDigits: 3}).format(props.reserved)}{' '}
					/ $0.250. Each request reserves $0.005, including failures. This is not billed spend. Drafts stay in this
					browser; saved notes stay on your server. Allowed tailnet members can access Notes without a separate login.
				</p>
			</DialogContent>
		</Dialog>
	)
}

function Capture(props: {online: boolean}) {
	const [draftState, setDraftState] = useState(initialDraft)
	const draft = draftState.text
	const pasteLabel = 'Paste & Save'
	const [open, setOpen] = useState(() => String.isNonEmpty(draft))
	const [message, setMessage] = useState('')
	const [saving, setSaving] = useState(false)
	const [pasting, setPasting] = useState(false)
	const pasteAttempted = useRef(false)
	const draftRevision = useRef(0)
	const capturePending = useRef(false)
	const composer = useRef<HTMLTextAreaElement>(null)
	const capture = useAtomSet(RpcClient.mutation('notes.capture'), {mode: 'promiseExit'})
	useEffect(
		() => () => {
			draftRevision.current += 1
		},
		[]
	)

	function updateDraft(text: string) {
		draftRevision.current += 1
		setPasting(false)
		const persisted = persistDraft(text)
		setDraftState(previous => ({
			...previous,
			...persisted,
			sharedWithDraft: previous.sharedWithDraft && String.isNonEmpty(text)
		}))
	}

	async function saveDraft(text: string) {
		if (capturePending.current || String.isEmpty(String.trim(text))) return
		if (text.length > 20000) {
			setMessage('Not saved. Keep each note under 20,000 characters. Your full draft is kept.')
			return
		}
		if (!props.online) {
			setMessage('Offline. Your draft is kept. Save when you are connected.')
			return
		}
		draftRevision.current += 1
		const revision = draftRevision.current
		capturePending.current = true
		setPasting(false)
		setSaving(true)
		setMessage('')
		const exit = await capture({payload: {text}})
		capturePending.current = false
		setSaving(false)
		if (draftRevision.current !== revision) return
		Exit.match(exit, {
			onFailure: () => {
				setMessage('Could not confirm the save. Your draft is kept.')
				setOpen(true)
			},
			onSuccess: note => {
				updateDraft('')
				pasteAttempted.current = false
				setOpen(false)
				setMessage(`Saved: ${note.title}`)
			}
		})
	}

	async function pasteClipboard(save: boolean) {
		if (String.isNonEmpty(draft) || pasting || capturePending.current) return
		pasteAttempted.current = true
		draftRevision.current += 1
		const revision = draftRevision.current
		setPasting(true)
		setMessage('')
		try {
			const text = await navigator.clipboard.readText()
			if (draftRevision.current !== revision) return
			updateDraft(text)
			if (String.isEmpty(text)) {
				setMessage('Your clipboard is empty.')
				setOpen(true)
				return
			}
			if (save) {
				if (text.length > 20000 || !props.online) setOpen(true)
				await saveDraft(text)
			}
		} catch {
			if (draftRevision.current !== revision) return
			setMessage('Clipboard access was not granted. Touch and hold the field, then choose Paste.')
			setOpen(true)
		} finally {
			if (draftRevision.current === revision) setPasting(false)
		}
	}

	const field = (
		<div className="flex flex-col gap-2">
			<div className="flex items-start gap-2">
				<Textarea
					id="capture"
					aria-label="New note"
					ref={composer}
					className="max-h-40 min-h-11 min-w-0 flex-1 overflow-y-auto"
					rows={2}
					value={draft}
					maxLength={20000}
					placeholder="Paste a link or write a note…"
					disabled={saving}
					onChange={event => {
						updateDraft(event.target.value)
						setMessage('')
					}}
					onClick={async () => {
						if (pasteAttempted.current || String.isNonEmpty(draft)) return
						await pasteClipboard(false)
					}}
				/>
				<Button
					size="icon-lg"
					className="size-11 shrink-0"
					aria-label={String.isNonEmpty(draft) ? 'Save note' : 'Paste clipboard'}
					aria-busy={saving || pasting}
					disabled={
						saving || pasting || (String.isNonEmpty(draft) && (!props.online || String.isEmpty(String.trim(draft))))
					}
					onClick={async () => {
						if (String.isNonEmpty(draft)) await saveDraft(draft)
						else await pasteClipboard(false)
					}}
				>
					{(saving || pasting) && <Spinner />}
					{!saving && !pasting && String.isNonEmpty(draft) && <ArrowUp className="size-4" />}
					{!saving && !pasting && String.isEmpty(draft) && <ClipboardPaste className="size-4" />}
				</Button>
			</div>
			{saving && (
				<p role="status" className="text-muted-foreground text-xs">
					Saving…
				</p>
			)}
			{draftState.sharedWithDraft && (
				<p role="status" className="text-muted-foreground text-xs">
					Shared text was added to your draft.
				</p>
			)}
			{String.isNonEmpty(message) && (
				<p role="alert" className="text-destructive text-xs">
					{message}
				</p>
			)}
			{String.isNonEmpty(draftState.storageIssue) && (
				<p role="alert" className="text-destructive text-xs">
					{draftState.storageIssue}
				</p>
			)}
		</div>
	)

	return (
		<section aria-label="Capture" className="flex shrink-0 flex-col gap-2">
			<div className="flex items-center gap-2">
				<Button
					className="min-h-11 min-w-0 flex-1"
					aria-label={pasteLabel}
					aria-busy={saving || pasting}
					disabled={saving || pasting || !props.online || String.isNonEmpty(draft)}
					onClick={() => pasteClipboard(true)}
				>
					{saving || pasting ? <Spinner /> : pasteLabel}
				</Button>
				<Dialog
					open={open}
					onOpenChange={value => {
						setOpen(value)
						if (!value && pasting) {
							draftRevision.current += 1
							setPasting(false)
						}
					}}
				>
					<DialogTrigger
						render={
							<Button
								variant={String.isNonEmpty(draft) ? 'secondary' : 'outline'}
								size="icon-lg"
								className="size-11"
								aria-label={String.isNonEmpty(draft) ? 'Edit draft' : 'New note'}
							/>
						}
					>
						<Plus className="size-4" />
					</DialogTrigger>
					<DialogContent showCloseButton={false} className="max-h-4/5 overflow-y-auto" initialFocus={composer}>
						<div className="flex items-center justify-between gap-2">
							<DialogTitle>New note</DialogTitle>
							<DialogClose render={<Button className="size-11" variant="outline" size="icon-lg" aria-label="Close" />}>
								<X className="size-4" />
							</DialogClose>
						</div>
						<DialogDescription className="sr-only">Paste a link or write a note, then save.</DialogDescription>
						{field}
					</DialogContent>
				</Dialog>
			</div>
			{!open && String.isNonEmpty(message) && (
				<p role="status" className="text-muted-foreground text-xs break-words">
					{message}
				</p>
			)}
			{!props.online && (
				<p role="status" className="text-muted-foreground text-xs">
					Offline · draft kept
				</p>
			)}
		</section>
	)
}

function NoteRow(props: {note: Note; onTag: (tag: string) => void}) {
	const [editing, setEditing] = useState(false)
	const [title, setTitle] = useState(props.note.title)
	const [tags, setTags] = useState(() => Array.join(props.note.tags, ', '))
	const [busy, setBusy] = useState(false)
	const [issue, setIssue] = useState('')
	const [confirmDelete, setConfirmDelete] = useState(false)
	const titleInput = useRef<HTMLInputElement>(null)
	const rowTrigger = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		if (editing) titleInput.current?.focus()
	}, [editing])
	const edit = useAtomSet(RpcClient.mutation('notes.edit'), {mode: 'promiseExit'})
	const remove = useAtomSet(RpcClient.mutation('notes.remove'), {mode: 'promiseExit'})
	function cancelEdit() {
		setEditing(false)
		rowTrigger.current?.focus()
	}
	return (
		<Collapsible className="py-2">
			<div className="flex items-start gap-2">
				<CollapsibleTrigger
					ref={rowTrigger}
					className="group focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1"
				>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<span className="line-clamp-2 text-sm break-words group-aria-expanded:line-clamp-none">
							{props.note.title}
						</span>
						<span className="text-muted-foreground text-xs break-words">
							{props.note.source} ·{' '}
							{DateTime.formatUtc(DateTime.makeUnsafe(props.note.createdAt), {day: 'numeric', month: 'short'})}
							{props.note.status === 'organizing' && ' · Organizing…'}
						</span>
					</span>
					<ChevronDown className="size-4 shrink-0 group-aria-expanded:rotate-180" />
				</CollapsibleTrigger>
				{props.note.url !== null && (
					<Button
						variant="outline"
						size="icon-lg"
						className="size-11"
						aria-label="Open original"
						role="link"
						nativeButton={false}
						render={<a href={props.note.url} target="_blank" rel="noopener noreferrer" />}
					>
						<ExternalLink className="size-4" />
					</Button>
				)}
			</div>
			<CollapsibleContent className="mt-3 flex flex-col gap-3">
				{String.isNonEmpty(props.note.summary) && <p className="text-muted-foreground text-sm">{props.note.summary}</p>}
				<div className="mt-2 flex flex-wrap gap-2">
					{Array.map(props.note.tags, value => (
						<Button
							key={value}
							variant="outline"
							size="lg"
							className="min-h-11 max-w-full"
							aria-label={`Filter by tag ${value}`}
							onClick={() => props.onTag(value)}
						>
							<span className="max-w-52 truncate">#{value}</span>
						</Button>
					))}
				</div>
				{String.isNonEmpty(props.note.issue) && (
					<p className="text-muted-foreground mt-2 text-xs">{props.note.issue}</p>
				)}
				<div className="flex flex-col gap-1">
					{String.isNonEmpty(props.note.content) && props.note.content !== props.note.raw && (
						<p className="text-muted-foreground text-xs">Submitted</p>
					)}
					<p className="text-sm break-words whitespace-pre-wrap">{props.note.raw}</p>
				</div>
				{String.isNonEmpty(props.note.content) && props.note.content !== props.note.raw && (
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-xs">Extracted</p>
						<p className="text-sm break-words whitespace-pre-wrap">{props.note.content}</p>
					</div>
				)}
				{editing && (
					<div
						className="flex flex-col gap-2"
						onKeyDown={event => {
							if (event.key === 'Escape' && !busy) {
								event.stopPropagation()
								cancelEdit()
							}
						}}
					>
						<Label htmlFor={`title-${props.note.id}`}>Title</Label>
						<Input
							id={`title-${props.note.id}`}
							ref={titleInput}
							className="h-11"
							disabled={busy}
							value={title}
							maxLength={200}
							onChange={event => setTitle(event.target.value)}
						/>
						<Label htmlFor={`tags-${props.note.id}`}>Tags, separated by commas</Label>
						<Input
							id={`tags-${props.note.id}`}
							className="h-11"
							disabled={busy}
							value={tags}
							onChange={event => setTags(event.target.value)}
						/>
					</div>
				)}
				<div className="flex items-center gap-2">
					{editing ? (
						<>
							<Button
								size="icon-lg"
								className="size-11"
								aria-label="Save changes"
								disabled={busy || String.isEmpty(String.trim(title))}
								onClick={async () => {
									setBusy(true)
									const exit = await edit({
										payload: {id: props.note.id, tags: parseTags(tags), title: String.trim(title)}
									})
									setBusy(false)
									Exit.match(exit, {
										onFailure: () =>
											setIssue(
												'Could not confirm the changes. Check Tailscale. Use up to 12 tags, each up to 40 characters.'
											),
										onSuccess: () => {
											setEditing(false)
											rowTrigger.current?.focus()
											setIssue('')
										}
									})
								}}
							>
								{busy ? <Spinner /> : <Check className="size-4" />}
							</Button>
							<Button
								size="icon-lg"
								className="size-11"
								variant="outline"
								aria-label="Cancel editing"
								disabled={busy}
								onClick={cancelEdit}
							>
								<X className="size-4" />
							</Button>
						</>
					) : (
						<Button
							size="icon-lg"
							className="size-11"
							variant="outline"
							aria-label="Edit note"
							disabled={busy || props.note.status === 'organizing'}
							onClick={() => {
								setTitle(props.note.title)
								setTags(Array.join(props.note.tags, ', '))
								setEditing(true)
							}}
						>
							<Pencil className="size-4" />
						</Button>
					)}
					<Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
						<DialogTrigger
							render={
								<Button size="icon-lg" className="size-11" variant="outline" aria-label="Delete note" disabled={busy} />
							}
						>
							<Trash2 className="size-4" />
						</DialogTrigger>
						<DialogContent showCloseButton={false} className="max-h-4/5 overflow-y-auto">
							<DialogClose
								render={
									<Button className="size-11 justify-self-end" variant="outline" size="icon-lg" aria-label="Close" />
								}
							>
								<X className="size-4" />
							</DialogClose>
							<DialogHeader>
								<DialogTitle>Delete this note?</DialogTitle>
								<DialogDescription>The saved text and tags will be removed.</DialogDescription>
							</DialogHeader>
							<Button
								variant="destructive"
								className="min-h-11 min-w-11"
								disabled={busy}
								onClick={async () => {
									setBusy(true)
									const exit = await remove({payload: {id: props.note.id}})
									setBusy(false)
									Exit.match(exit, {
										onFailure: () => {
											setConfirmDelete(false)
											setIssue('Could not delete this note.')
										},
										onSuccess: () => setConfirmDelete(false)
									})
								}}
							>
								Delete
							</Button>
						</DialogContent>
					</Dialog>
				</div>
				{String.isNonEmpty(issue) && (
					<p role="alert" className="text-destructive text-xs">
						{issue}
					</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	)
}
