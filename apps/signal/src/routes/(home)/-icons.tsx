import {cn} from '@deslop/components-web/utils'

// SVGL's DeepSeek mark; Xiaomi is from Simple Icons and Z.ai from its official site (not in SVGL).
import deepseek from './-brands/deepseek.svg'
import xiaomi from './-brands/xiaomi.svg'

const BRANDS = [deepseek, xiaomi]

export function TeamIcon(props: {team: number; className?: string}) {
	if (props.team === 2) {
		return (
			<svg aria-hidden="true" viewBox="0 0 30 30" fill="currentColor" className={props.className}>
				<path d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z" />
				<polygon points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1" />
				<path d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z" />
			</svg>
		)
	}
	return (
		<span
			aria-hidden="true"
			className={cn('block bg-current mask-(--brand) mask-contain mask-center mask-no-repeat', props.className)}
			style={{'--brand': `url("${BRANDS[props.team] ?? deepseek}")`}}
		/>
	)
}
