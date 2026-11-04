import {Boolean, String} from 'effect'

import {Monitor, Server} from 'lucide-react'

export function machineName(worker: string) {
	return String.split(worker, '.')[0]
}

export function MachineIcon(props: {worker: string}) {
	return (
		<span
			title={props.worker}
			aria-label={props.worker}
			role="img"
			className={`inline-flex shrink-0 items-center justify-center ${Boolean.match(
				machineName(props.worker) === 'desktop',
				{onFalse: () => 'text-machine-dev', onTrue: () => 'text-machine-desktop'}
			)}`}
			data-machine={machineName(props.worker)}
		>
			{Boolean.match(machineName(props.worker) === 'desktop', {
				onFalse: () => <Server className="size-4" />,
				onTrue: () => <Monitor className="size-4" />
			})}
		</span>
	)
}
