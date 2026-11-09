import {cva} from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority'

import {cn} from '#lib/utils.ts'

const statusDotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
	defaultVariants: {status: 'live'},
	variants: {
		status: {
			error: 'bg-destructive',
			live: 'bg-primary shadow-(--glow-live)',
			off: 'border-muted-foreground border',
			quiet: 'bg-muted-foreground/50',
			warning: 'bg-warning'
		}
	}
})

// The status dot, beside a word that says the same: live in the app's hue with the system's one glow, quiet muted, off hollow; a waiting one wears a ring.
export function StatusDot(props: VariantProps<typeof statusDotVariants> & {className?: string; waiting?: boolean}) {
	return (
		<span
			data-slot="status-dot"
			aria-hidden="true"
			className={cn(
				statusDotVariants({status: props.status}),
				props.waiting === true && 'outline-primary/25 outline outline-2 outline-offset-2',
				props.className
			)}
		/>
	)
}
