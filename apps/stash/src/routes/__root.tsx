import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Array, Boolean} from 'effect'

import {Host, NavigationDestination, NavigationStack, ProgressView, useNativeState} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {queryAtom} from '#lib/utils.ts'
import type {Kind} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import {NoteRoute} from '#routes/notes/$id.tsx'
import {colors} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

export function RootRoute() {
	useAtomMount(updateAtom)
	const [path, setPath] = useState<string[]>([])
	const setQuery = useAtomSet(queryAtom)
	const [tag, setTag] = useState('')
	const [kind, setKind] = useState<Kind | ''>('')
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
						{Boolean.match(id === 'compose', {
							onFalse: () => (
								<NoteRoute
									id={id}
									onClose={() => setPath([])}
									onTag={name => {
										setTag(name)
										setPath([])
									}}
								/>
							),
							onTrue: () => <ComposeRoute onDone={() => setPath([])} />
						})}
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
