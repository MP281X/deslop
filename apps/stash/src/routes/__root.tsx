import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Array, Match, pipe} from 'effect'

import {Host, NavigationDestination, NavigationStack, useNativeState} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {BlankScreen, SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {updateAtom} from '@deslop/runtime/mobile'

import {primary, queryAtom, session} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import logo from '#routes/icon.png'
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
				<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
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

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<SessionGate logo={logo} session={session.machine} tint={primary}>
				<AppRoutes />
			</SessionGate>
		</Suspense>
	)
}
