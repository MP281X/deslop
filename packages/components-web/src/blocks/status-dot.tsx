import {cva} from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority'

const statusDotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
	variants: {status: {error: 'bg-destructive', off: 'border-muted-foreground border', warning: 'bg-warning'}}
})

// The status dot marks a problem, never healthy state: error in red, warning in amber, off hollow. Its label names the problem to assistive technology and on hover.
export function StatusDot(props: {
	label: string
	status: NonNullable<VariantProps<typeof statusDotVariants>['status']>
}) {
	return (
		<span
			data-slot="status-dot"
			role="img"
			aria-label={props.label}
			title={props.label}
			className={statusDotVariants({status: props.status})}
		/>
	)
}
