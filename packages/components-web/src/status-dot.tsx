import {cva} from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority'

import {cn} from '#lib/classes.ts'

const statusDotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
	variants: {
		status: {
			error: 'bg-destructive',
			off: 'border-muted-foreground border',
			quiet: 'bg-muted-foreground/50',
			warning: 'bg-warning'
		}
	}
})

// The status dot marks a problem, never healthy state: error in red, warning in amber, off hollow, quiet muted.
export function StatusDot(props: {
	className?: string
	status: NonNullable<VariantProps<typeof statusDotVariants>['status']>
}) {
	return (
		<span
			data-slot="status-dot"
			aria-hidden="true"
			className={cn(statusDotVariants({status: props.status}), props.className)}
		/>
	)
}
