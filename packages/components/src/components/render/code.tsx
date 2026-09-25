// fallow-ignore-file unused-file -- Public render component retained for the Workbench rebuild.
import DOMPurify from 'dompurify'

import {highlightCode} from '#lib/shiki.ts'
import {cn} from '#lib/utils.ts'

export function Code(props: {children: string; className?: string; lang?: string}) {
	return (
		<div
			data-code-block
			// oxlint-disable-next-line react/no-danger -- Shiki output is sanitized immediately before this React HTML boundary.
			dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(highlightCode(props.children, props.lang))}}
			className={cn('bg-muted/30 overflow-hidden select-text [&_*]:select-text', props.className)}
		/>
	)
}
