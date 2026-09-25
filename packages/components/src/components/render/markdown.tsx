// fallow-ignore-file unused-file -- Public render component retained for the Workbench rebuild.
import {Array, Match, pipe} from 'effect'

import DOMPurify from 'dompurify'
import {Marked} from 'marked'

import {Code} from './code.tsx'
import {Mermaid} from './mermaid.tsx'

import {cn} from '#lib/utils.ts'

const marked = new Marked({async: false, breaks: true, gfm: true})

export function Markdown(props: {children: string; className?: string}) {
	return (
		<div className={cn('markdown text-wrap wrap-break-word select-text', props.className)}>
			{Array.map(marked.lexer(props.children), (token, index) =>
				pipe(
					Match.value(token),
					Match.when({type: 'html'}, () => null),
					Match.when({lang: 'mermaid', type: 'code'}, code => (
						<Mermaid key={`${token.type}:${index}:${code.text}`} className="border-border border">
							{code.text}
						</Mermaid>
					)),
					Match.when({type: 'code'}, code => (
						<Code
							key={`${token.type}:${index}:${code.lang ?? ''}:${code.text}`}
							className="border-border border"
							lang={code.lang}
						>
							{code.text}
						</Code>
					)),
					Match.orElse(other => (
						<div
							key={`${other.type}:${index}:${other.raw}`}
							// oxlint-disable-next-line react/no-danger -- Marked output is sanitized immediately before this React HTML boundary.
							dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(other.raw, {async: false}))}}
						/>
					))
				)
			)}
		</div>
	)
}
