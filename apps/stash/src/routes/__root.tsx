import {useAtom, useAtomMount, useAtomSet, useAtomSuspense} from '@effect/atom-react'

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
import {updateAtom} from '@deslop/runtime/mobile'

import {queryAtom, session, signInAtom} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import logo from '#routes/logo.png'
import {NoteRoute} from '#routes/notes/$id.tsx'
import type {Kind} from '#services/notes/schema.ts'

function AppRoutes() {
	const [path, setPath] = useState<string[]>([])
	const setQuery = useAtomSet(queryAtom)
	const [tag, setTag] = useState<string>()
	const [kind, setKind] = useState<Kind>()
	const query = useNativeState('')

	return (
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

function SessionRoute() {
	const saved = useAtomSuspense(session.atom).value
	const [signIn, start] = useAtom(signInAtom)
	const logoUri = useAtomSuspense(assetAtom(logo)).value
	if (Option.isSome(saved)) return <AppRoutes />
	return (
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
				<Image
					uiImage={logoUri}
					modifiers={[resizable(), frame({height: 64, width: 64}), frame({maxHeight: Infinity}), padding({bottom: 64})]}
				/>
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

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense
			fallback={
				<Host style={{flex: 1}}>
					<ProgressView />
				</Host>
			}
		>
			<SessionRoute />
		</Suspense>
	)
}
