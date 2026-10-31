import {cva} from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority'

import {cn} from '#lib/utils.ts'

const statusDotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
	defaultVariants: {status: 'live'},
	variants: {
		status: {
			error: 'bg-destructive',
			live: 'bg-primary',
			off: 'border-muted-foreground border',
			quiet: 'bg-muted-foreground/50',
			warning: 'bg-warning'
		}
	}
})

// DESIGN.md's status dot, beside a word that says the same: live in the app's hue, quiet muted, off hollow; a waiting one breathes.
export function StatusDot(props: VariantProps<typeof statusDotVariants> & {className?: string; waiting?: boolean}) {
	return (
		<span
			data-slot="status-dot"
			aria-hidden="true"
			className={cn(
				statusDotVariants({status: props.status}),
				props.waiting === true && 'motion-safe:animate-pulse',
				props.className
			)}
		/>
	)
}
