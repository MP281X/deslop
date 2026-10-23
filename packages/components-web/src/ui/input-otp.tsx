import {OTPInput, OTPInputContext} from 'input-otp'
import {MinusIcon} from 'lucide-react'
import type * as React from 'react'
import {useContext} from 'react'

import {cn} from '#lib/utils.ts'

function InputOTP({
	className,
	containerClassName,
	...props
}: React.ComponentProps<typeof OTPInput> & {containerClassName?: string}) {
	return (
		<OTPInput
			data-slot="input-otp"
			containerClassName={cn('flex items-center has-disabled:opacity-50', containerClassName)}
			spellCheck={false}
			className={cn('disabled:cursor-not-allowed', className)}
			{...props}
		/>
	)
}

function InputOTPGroup({className, ...props}: React.ComponentProps<'div'>) {
	return <div data-slot="input-otp-group" className={cn('flex items-center', className)} {...props} />
}

function InputOTPSlot({index, className, ...props}: React.ComponentProps<'div'> & {index: number}) {
	const slot = useContext(OTPInputContext).slots[index]
	return (
		<div
			data-slot="input-otp-slot"
			data-active={slot?.isActive}
			className={cn(
				'border-input dark:bg-input/30 data-[active=true]:border-ring data-[active=true]:ring-ring/50 aria-invalid:border-destructive relative flex size-8 items-center justify-center border-y border-r text-xs transition-all outline-none first:border-l data-[active=true]:z-10 data-[active=true]:ring-1',
				className
			)}
			{...props}
		>
			{slot?.char}
			{slot?.hasFakeCaret && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="bg-foreground h-1/2 w-px motion-safe:animate-pulse" />
				</div>
			)}
		</div>
	)
}

function InputOTPSeparator(props: React.ComponentProps<'div'>) {
	return (
		<div data-slot="input-otp-separator" className="flex items-center [&_svg]:size-4" role="separator" {...props}>
			<MinusIcon />
		</div>
	)
}

export {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot}
