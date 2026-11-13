import {useAtomSet} from '@effect/atom-react'

import {Array, Match, Schema, pipe} from 'effect'

import {Host, NavigationDestination, NavigationStack, useNativeState} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'

import {queryAtom} from '#lib/notes.ts'
import {primary, session} from '#lib/session.ts'
import {HomeRoute} from '#routes/(home)/index.tsx'
import {ComposeRoute} from '#routes/compose.tsx'
import logo from '#routes/icon.png'
import {NoteRoute, NoteSkeleton} from '#routes/notes/$id.tsx'
import type {Kind, TagName} from '#services/notes/schema.ts'
import {NoteId} from '#services/notes/schema.ts'

type NavigationPath = typeof NavigationPath.Type
const NavigationPath = Schema.Union([NoteId, Schema.Literal('compose')])

function AppRoutes() {
	const [path, setPath] = useState<NavigationPath[]>([])
	const setQuery = useAtomSet(queryAtom)
	const [tag, setTag] = useState<TagName>()
	const [kind, setKind] = useState<Kind>()
	const query = useNativeState('')

	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={values =>
					setPath(
						Array.map(values, value => {
							if (value === 'compose') return value
							return NoteId.make(value)
						})
					)
				}
				modifiers={[tint(colors.foreground)]}
			>
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
				{Array.map(path, id => (
					<NavigationDestination key={id} value={id}>
						<Suspense fallback={<NoteSkeleton />}>
							{pipe(
								Match.value(id),
								Match.when('compose', () => <ComposeRoute onDone={() => setPath([])} />),
								Match.orElse(() => (
									<NoteRoute
										id={NoteId.make(id)}
										onClose={() => setPath([])}
										onTag={name => {
											setTag(name)
											setPath([])
										}}
									/>
								))
							)}
						</Suspense>
					</NavigationDestination>
				))}
			</NavigationStack>
		</Host>
	)
}

export function RootRoute() {
	return (
		<SessionGate logo={logo} session={session} tint={primary}>
			<AppRoutes />
		</SessionGate>
	)
}
