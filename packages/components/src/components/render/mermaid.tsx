// fallow-ignore-file unused-file -- Public render component retained for the Workbench rebuild.
import {useAtomSuspense} from '@effect/atom-react'

import {Cause, Effect, Hash, String} from 'effect'

import DOMPurify from 'dompurify'
import {AsyncResult, Atom} from 'effect/unstable/reactivity'
import mermaid from 'mermaid'

import {cn} from '#lib/utils.ts'

const mermaidAtom = Atom.family((source: string) =>
	Atom.make(
		Effect.tryPromise(() => {
			mermaid.initialize({securityLevel: 'strict', startOnLoad: false})
			return mermaid.render(`mermaid_${Hash.string(source)}`, source)
		})
	)
)

export function Mermaid(props: {children: string; className?: string}) {
	const result = useAtomSuspense(mermaidAtom(props.children), {includeFailure: true})

	if (AsyncResult.isFailure(result)) {
		return (
			<pre
				className={cn(
					'border-border bg-muted/30 text-destructive border px-2 py-2 whitespace-pre-wrap',
					props.className
				)}
			>
				{String.trim(Cause.pretty(result.cause))}
			</pre>
		)
	}

	return (
		<div
			// oxlint-disable-next-line react/no-danger -- Mermaid output is sanitized immediately before this React HTML boundary.
			dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(result.value.svg)}}
			className={cn(
				'bg-muted/30 overflow-hidden p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full',
				props.className
			)}
		/>
	)
}
