import {cva, type VariantProps} from 'class-variance-authority'
import type * as React from 'react'

import {cn} from '#lib/utils.ts'

const spinnerVariants = cva('animation-duration-[2.5s] size-4 animate-spin border-current', {
	variants: {
		variant: {
			default: 'border-2 opacity-50',
			subtle: 'text-muted-foreground border opacity-60'
		}
	},
	defaultVariants: {variant: 'default'}
})

function Spinner({className, variant, ...props}: React.ComponentProps<'div'> & VariantProps<typeof spinnerVariants>) {
	return <div role="status" aria-label="Loading" className={cn(spinnerVariants({className, variant}))} {...props} />
}

export {Spinner}
