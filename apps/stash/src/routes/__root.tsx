import {RegistryContext, useAtomMount, useAtomSet} from '@effect/atom-react'

import {Array, Boolean, Option, Schema, pipe} from 'effect'

import {Host} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useContext, useState} from 'react'

import {ListDetail} from '@deslop/components-mobile/blocks/list-detail'
import {PasteSheet} from '@deslop/components-mobile/blocks/paste-sheet'
import {SessionGate} from '@deslop/components-mobile/blocks/session-gate'
import {colors} from '@deslop/components-mobile/theme'

import {clipboard} from '#lib/clipboard.ts'
import {notesAtom, queryAtom} from '#lib/notes.ts'
import {session} from '#lib/session.ts'
import {sharesAtom} from '#lib/shares.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import {NoteRoute, NoteSkeleton} from '#routes/notes/$id.tsx'
import type {Kind, TagName} from '#services/notes/schema.ts'
import {NoteId} from '#services/notes/schema.ts'

// What the item side shows: a note, or the draft of a new one.
type Opened = typeof Opened.Type
const Opened = Schema.Union([NoteId, Schema.Literal('compose')])

function AppRoutes() {
	const [opened, setOpened] = useState(Option.none<Opened>)
	const setQuery = useAtomSet(queryAtom)
	const [tag, setTag] = useState(Option.none<TagName>)
	const [kind, setKind] = useState(Option.none<Kind>)
	useAtomMount(sharesAtom)
	// Read only when the queue hides: a root that renders again on every note moves the split view mid-unfold, and the note beside a hidden queue keeps the outer screen's size.
	const registry = useContext(RegistryContext)

	return (
		<Host style={{flex: 1}}>
			{/* Over the whole window, so the list's copy below an item in laptop posture asks once. */}
			<PasteSheet clipboard={clipboard}>
				<ListDetail
					opened={Option.isSome(opened)}
					onClose={() => setOpened(Option.none())}
					onHide={() =>
						pipe(
							AsyncResult.value(registry.get(notesAtom)),
							Option.flatMap(Array.head),
							Option.map(note => setOpened(Option.some(note.id)))
						)
					}
					modifiers={[tint(colors.foreground)]}
					list={
						<HomeRoute
							tag={tag}
							kind={kind}
							onCompose={() => setOpened(Option.some('compose'))}
							onKind={setKind}
							onOpen={id => setOpened(Option.some(id))}
							onSearch={setQuery}
							onTag={setTag}
						/>
					}
					detail={pipe(
						opened,
						Option.contains<Opened>('compose'),
						Boolean.match({
							onFalse: () => (
								<Suspense fallback={<NoteSkeleton />}>
									<NoteRoute
										id={Option.filter(opened, (id): id is NoteId => id !== 'compose')}
										onClose={() => setOpened(Option.none())}
										onTag={name => setTag(Option.some(name))}
									/>
								</Suspense>
							),
							onTrue: () => <ComposeRoute onDone={() => setOpened(Option.none())} />
						})
					)}
				/>
			</PasteSheet>
		</Host>
	)
}

export function RootRoute() {
	return (
		<SessionGate session={session}>
			<AppRoutes />
		</SessionGate>
	)
}
