import {Boolean, String} from 'effect'

import {MonitorIcon, HardDrivesIcon} from '@phosphor-icons/react'

export function machineName(worker: string) {
	return String.split(worker, '.')[0]
}

export function MachineIcon(props: {worker: string}) {
	return (
		<span
			aria-hidden="true"
			className={`inline-flex shrink-0 items-center justify-center ${Boolean.match(
				machineName(props.worker) === 'desktop',
				{onFalse: () => 'text-machine-dev', onTrue: () => 'text-machine-desktop'}
			)}`}
		>
			{Boolean.match(machineName(props.worker) === 'desktop', {
				onFalse: () => <HardDrivesIcon className="size-4" />,
				onTrue: () => <MonitorIcon className="size-4" />
			})}
		</span>
	)
}
