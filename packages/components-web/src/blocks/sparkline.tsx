import {Array} from 'effect'

import {Line, LineChart, YAxis} from 'recharts'

import {cn} from '#lib/utils.ts'

// A line of a period's figures in its box, 64×14 unless the screen gives another size; zeros rest on the baseline, and `max` fixes the top where the figures have one, such as 100%. It sizes from its box, so a hidden one draws nothing.
export function Sparkline(props: {className?: string; max?: number; values: readonly number[]}) {
	return (
		<div aria-hidden className={cn('h-3.5 w-16', props.className)}>
			<LineChart
				responsive
				width="100%"
				height="100%"
				data={Array.map(props.values, value => ({value}))}
				margin={{bottom: 1, left: 1, right: 1, top: 1}}
			>
				<YAxis hide domain={[0, props.max ?? 'dataMax']} />
				<Line
					dataKey="value"
					type="linear"
					stroke="var(--muted-foreground)"
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
			</LineChart>
		</div>
	)
}
