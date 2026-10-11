import type * as React from 'react'

import {cn} from '#lib/utils.ts'

function Textarea({className, ...props}: React.ComponentProps<'textarea'>) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:disabled:bg-input/80 flex field-sizing-content min-h-16 w-full rounded-none border bg-transparent px-2.5 py-2 font-normal transition-colors outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-1',
				className
			)}
			{...props}
		/>
	)
}

export {Textarea}
