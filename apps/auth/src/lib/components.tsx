import {useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Option} from 'effect'

import {GlobeIcon} from '@phosphor-icons/react'

import {ThemedMark} from '@deslop/components-web/blocks/marks'
import {RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded} from '@deslop/components-web/blocks/states'
import {Badge} from '@deslop/components-web/ui/badge'
import {AndroidIcon} from '@deslop/components-web/ui/svgs/androidIcon'
import {Apple} from '@deslop/components-web/ui/svgs/apple'
import {AppleDark} from '@deslop/components-web/ui/svgs/appleDark'
import {Linux} from '@deslop/components-web/ui/svgs/linux'
import {Windows} from '@deslop/components-web/ui/svgs/windows'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {clockAtom} from '@deslop/runtime/client/clock'
import {ageOf} from '@deslop/runtime/shared/format'

import {sessionsAtom} from '#lib/auth.ts'
import {browserOf, deviceOf} from '#services/cookie-sessions/lib/utils.ts'
import type {SessionDevice} from '#services/cookie-sessions/schema.ts'

function DeviceLogo(props: {device: Option.Option<SessionDevice>}) {
	return Option.match(props.device, {
		onNone: () => <GlobeIcon className="size-4" />,
		onSome: device => {
			if (device === 'Android') return <AndroidIcon aria-hidden className="size-4" />
			if (device === 'Windows') return <Windows aria-hidden className="size-4" />
			if (device === 'Linux') return <Linux aria-hidden className="size-4" />
			return <ThemedMark light={Apple} dark={AppleDark} className="size-4" />
		}
	})
}

// The device's own logo, named for screen readers since the row shows no device text, else a globe for an agent that names none.
function DeviceMark(props: {device: Option.Option<SessionDevice>}) {
	return (
		<span
			role="img"
			aria-label={Option.getOrElse(props.device, Function.constant('Unknown device'))}
			className="inline-flex"
		>
			<DeviceLogo device={props.device} />
		</span>
	)
}

export function Sessions() {
	const now = useAtomValue(clockAtom('1 minute'))
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
												onTrue: () => (
													<Badge variant="secondary" className="shrink-0">
														This browser
													</Badge>
												)
											})}
											detail={Option.getOrUndefined(session.address)}
										>
											{browserOf(session.browser)}
										</RowLead>
										<TableCell className="text-right">
											<span className="text-muted-foreground tabular-nums">{ageOf(session.lastSeenAt, now)}</span>
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
