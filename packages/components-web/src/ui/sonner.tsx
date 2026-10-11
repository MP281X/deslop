'use client'

import {CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon} from 'lucide-react'
import type * as React from 'react'
import {Toaster as Sonner, type ToasterProps, toast} from 'sonner'

import {Spinner} from '#components/ui/spinner.tsx'

export function Toaster({...props}: ToasterProps) {
	return (
		<Sonner
			theme="system"
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Spinner className="size-4" />
			}}
			style={
				{
					'--normal-bg': 'var(--popover)',
					'--normal-text': 'var(--popover-foreground)',
					'--normal-border': 'var(--border)',
					'--border-radius': 'var(--radius)'
				} as React.CSSProperties
			}
			toastOptions={{classNames: {toast: 'cn-toast'}}}
			{...props}
		/>
	)
}

export {toast}
