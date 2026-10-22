import {useAtom, useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Match, Option, pipe} from 'effect'

import {
	Button,
	Host,
	Image,
	NavigationDestination,
	NavigationStack,
	ProgressView,
	Text,
	VStack,
	useNativeState
} from '@expo/ui/swift-ui'
import {
	background,
	buttonStyle,
	controlSize,
	disabled,
	foregroundStyle,
	frame,
	padding,
	resizable,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'
import {assetAtom} from '@deslop/components-mobile/utils'

import {queryAtom, sessionAtom, signInAtom} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import logo from '#routes/logo.png'
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
	const logoUri = useAtomSuspense(assetAtom(logo)).value
	if (Option.isSome(session)) return <AppRoutes />
	return (
		// oxlint-disable-next-line shadcn/no-inline-styles -- The native SwiftUI host fills the React Native screen.
		<Host style={{flex: 1}}>
			<VStack
				spacing={20}
				// The padding comes first so the colour behind it reaches every edge of the screen.
				modifiers={[
					padding({all: 24}),
					frame({maxHeight: Infinity, maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<VStack spacing={16} modifiers={[frame({maxHeight: Infinity, maxWidth: Infinity}), padding({bottom: 64})]}>
					<Image uiImage={logoUri} modifiers={[resizable(), frame({height: 44, width: 44})]} />
					<Text modifiers={[mono('headline', 20), foregroundStyle(colors.foreground)]}>Sign in to Stash</Text>
				</VStack>
				<Button
					onPress={() => start()}
					modifiers={[
						buttonStyle('glassProminent'),
						controlSize('large'),
						tint(colors.primary),
						foregroundStyle(colors.primaryForeground),
						disabled(AsyncResult.isWaiting(signIn))
					]}
				>
					<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>Sign in with GitHub</Text>
				</Button>
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
