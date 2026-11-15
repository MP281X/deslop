import {Array, Boolean, DateTime, Function, Option} from 'effect'

import {GlobeIcon, LinuxLogoIcon, WindowsLogoIcon} from '@phosphor-icons/react'

import {ThemedMark} from '@deslop/components-web/blocks/marks'
import {RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded} from '@deslop/components-web/blocks/states'
import {AndroidIcon} from '@deslop/components-web/ui/svgs/androidIcon'
import {Apple} from '@deslop/components-web/ui/svgs/apple'
import {AppleDark} from '@deslop/components-web/ui/svgs/appleDark'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {ageOf} from '@deslop/runtime/shared/format'

import {sessionsAtom} from '#lib/auth.ts'
import {deviceOf, sessionLabel} from '#services/cookie-sessions/lib/utils.ts'
import type {Device} from '#services/cookie-sessions/schema.ts'

// The device's own logo, else a globe for an agent that names none.
function DeviceMark(props: {device: Option.Option<Device>}) {
	return Option.match(props.device, {
		onNone: () => <GlobeIcon className="size-4" />,
		onSome: device => {
			if (device === 'Android') return <AndroidIcon aria-hidden className="size-4" />
			if (device === 'Windows') return <WindowsLogoIcon className="size-4" />
			if (device === 'Linux') return <LinuxLogoIcon className="size-4" />
			return <ThemedMark light={Apple} dark={AppleDark} className="size-4" />
		}
	})
}

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
										<RowLead
											mark={<DeviceMark device={deviceOf(session.browser)} />}
											after={Boolean.match(session.current, {
												onFalse: Function.constNull,
												onTrue: () => <span className="text-muted-foreground shrink-0">This browser</span>
											})}
											detail={Option.getOrUndefined(session.address)}
										>
											{sessionLabel(session.browser)}
										</RowLead>
										<TableCell className="text-right">
											<span className="text-muted-foreground tabular-nums">
												{ageOf(session.lastSeenAt, DateTime.nowUnsafe())}
											</span>
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
