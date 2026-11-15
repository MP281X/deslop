import {Array, DateTime, Function, Option} from 'effect'

import {Loaded} from '@deslop/components-web/blocks/states'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {ageOf} from '@deslop/runtime/shared/format'

import {sessionsAtom} from '#lib/auth.ts'

export function Sessions() {
	return (
		<Loaded atom={sessionsAtom}>
			{rows =>
				Array.match(rows, {
					onEmpty: () => <p className="text-muted-foreground">No browser sessions</p>,
					onNonEmpty: sessions => (
						<Table aria-label="Browser sessions">
							<TableBody>
								{Array.map(sessions, session => (
									<TableRow key={session.id}>
										<TableCell>
											<span className="block max-w-80 truncate">{session.browser}</span>
										</TableCell>
										<TableCell>{Option.getOrElse(session.address, Function.constant(''))}</TableCell>
										<TableCell className="text-right">
											<span className="text-muted-foreground">{ageOf(session.lastSeenAt, DateTime.nowUnsafe())}</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)
				})
			}
		</Loaded>
	)
}
