import {useAtomMount, useAtomRefresh} from '@effect/atom-react'

import {Array, Predicate} from 'effect'

import {
	Button,
	ContentUnavailableView,
	Host,
	NavigationDestination,
	NavigationStack,
	ProgressView,
	VStack,
	useNativeState
} from '@expo/ui/swift-ui'
import {background, foregroundStyle, tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'

import {deliveryAtom, pasteAtom, pendingAtom} from '#lib/utils.ts'
import {NotesRoute} from '#routes/(home)/index.tsx'
import {NoteRoute} from '#routes/note.tsx'
import {colors, mono} from '@deslop/components/mobile/theme'

export function RootRoute() {
	useAtomMount(deliveryAtom)
	useAtomMount(pasteAtom)
	const refreshPending = useAtomRefresh(pendingAtom)
	const [path, setPath] = useState<string[]>([])
	const [search, setSearch] = useState('')
	const query = useNativeState('')

	// Typing already updates the native field, so only a tapped tag writes it.
	function searchTag(tag: string) {
		query.set(`#${tag} `)
		setSearch(`#${tag} `)
		setPath([])
	}

	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The SwiftUI host is a React Native view and fills the screen through its style.
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.primary), background(colors.background)]}
			>
				<ErrorBoundary
					onReset={refreshPending}
					fallbackRender={failure => (
						<VStack spacing={16}>
							<ContentUnavailableView
								title="couldn’t load"
								description={
									Predicate.hasProperty(failure.error, 'message') && Predicate.isString(failure.error.message)
										? failure.error.message
										: 'something went wrong'
								}
								modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}
							/>
							<Button label="try again" onPress={failure.resetErrorBoundary} modifiers={[mono('body', 14)]} />
						</VStack>
					)}
				>
					<Suspense fallback={<ProgressView />}>
						<NotesRoute
							query={query}
							search={search}
							onOpen={id => setPath([id])}
							onSearch={setSearch}
							onTag={searchTag}
						/>
					</Suspense>
				</ErrorBoundary>
				{Array.map(path, id => (
					<NavigationDestination key={id} value={id}>
						<NoteRoute id={id} onTag={searchTag} />
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
