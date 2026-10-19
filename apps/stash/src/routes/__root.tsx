import {useAtom, useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Match, Option, pipe} from 'effect'

import {
	Button,
	Host,
	NavigationDestination,
	NavigationStack,
	ProgressView,
	Text,
	VStack,
	useNativeState
} from '@expo/ui/swift-ui'
import {background, buttonStyle, disabled, frame, tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {colors} from '@deslop/components-mobile/theme'

import {queryAtom, sessionAtom, signInAtom} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import {NoteRoute} from '#routes/notes/$id.tsx'
import type {Kind} from '#services/notes/schema.ts'

export function RootRoute() {
	return (
		<Suspense
			fallback={
				// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
				<Host style={{flex: 1}}>
					<ProgressView />
				</Host>
			}
		>
			<SessionRoute />
		</Suspense>
	)
}

function SessionRoute() {
	const session = useAtomSuspense(sessionAtom).value
	const [signIn, start] = useAtom(signInAtom)
	if (Option.isSome(session)) return <AppRoutes />
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<VStack
				spacing={20}
				modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), background(colors.background)]}
			>
				<Text>Sign in to Stash</Text>
				<Button
					label="Sign in with GitHub"
					onPress={() => start()}
					modifiers={[buttonStyle('glassProminent'), disabled(AsyncResult.isWaiting(signIn))]}
				/>
			</VStack>
		</Host>
	)
}

function AppRoutes() {
	const [path, setPath] = useState<string[]>([])
	const setQuery = useAtomSet(queryAtom)
	const [tag, setTag] = useState<string>()
	const [kind, setKind] = useState<Kind>()
	const query = useNativeState('')

	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The SwiftUI host is a React Native view and fills the screen through its style.
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<Suspense fallback={<ProgressView />}>
					<HomeRoute
						query={query}
						tag={tag}
						kind={kind}
						onCompose={() => setPath(['compose'])}
						onKind={setKind}
						onOpen={id => setPath([id])}
						onSearch={setQuery}
						onTag={setTag}
					/>
				</Suspense>
				{Array.map(path, id => (
					<NavigationDestination key={id} value={id}>
						{pipe(
							Match.value(id),
							Match.when('compose', () => <ComposeRoute onDone={() => setPath([])} />),
							Match.orElse(() => (
								<NoteRoute
									id={id}
									onClose={() => setPath([])}
									onTag={name => {
										setTag(name)
										setPath([])
									}}
								/>
							))
						)}
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
