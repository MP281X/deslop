import {useAtomMount} from '@effect/atom-react'

import {Array} from 'effect'

import {Host, NavigationDestination, NavigationStack, ProgressView, useNativeState} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import type {Kind} from '#lib/utils.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import {NoteRoute} from '#routes/notes/$id.tsx'
import {colors} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

export function RootRoute() {
	useAtomMount(updateAtom)
	const [path, setPath] = useState<string[]>([])
	const [search, setSearch] = useState('')
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
						search={search}
						tag={tag}
						kind={kind}
						onCompose={() => setPath(['compose'])}
						onKind={setKind}
						onOpen={id => setPath([id])}
						onSearch={setSearch}
						onTag={setTag}
					/>
				</Suspense>
				{Array.map(path, id => (
					<NavigationDestination key={id} value={id}>
						{id === 'compose' ? (
							<ComposeRoute onDone={() => setPath([])} />
						) : (
							<NoteRoute
								id={id}
								onTag={name => {
									setTag(name)
									setPath([])
								}}
							/>
						)}
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}
