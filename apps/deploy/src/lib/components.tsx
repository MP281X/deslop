import {Boolean, String} from 'effect'

import {Monitor, Server} from 'lucide-react'

export function machineName(worker: string) {
	return String.split(worker, '.')[0] ?? worker
}

export function machineColor(worker: string) {
	if (machineName(worker) === 'desktop') return 'var(--purple)'
	if (machineName(worker) === 'dev') return 'var(--cyan)'
	return 'var(--primary)'
}

export function MachineIcon(props: {worker: string}) {
	return (
		<span
			title={props.worker}
			aria-label={props.worker}
			role="img"
			className="inline-flex shrink-0 text-(--machine)"
			style={{'--machine': machineColor(props.worker)}}
		>
			{Boolean.match(machineName(props.worker) === 'desktop', {
				onFalse: () => <Server className="size-4" />,
				onTrue: () => <Monitor className="size-4" />
			})}
		</span>
	)
}
