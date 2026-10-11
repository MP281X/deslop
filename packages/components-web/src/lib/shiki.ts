import {Array, Match, Option, String, pipe} from 'effect'

import {getSharedHighlighter} from '@pierre/diffs'

export const HIGHLIGHT_THEMES = {dark: 'github-dark-default', light: 'github-light-default'} as const
const HIGHLIGHT_LANGS = ['tsx', 'shell', 'markdown', 'diff', 'jsonc'] as const

const highlighter = await getSharedHighlighter({
	langs: [...HIGHLIGHT_LANGS],
	themes: [HIGHLIGHT_THEMES.light, HIGHLIGHT_THEMES.dark]
})

export function resolveLanguage(lang?: string) {
	return pipe(
		Match.value(
			pipe(
				String.toLowerCase(lang ?? ''),
				String.split('.'),
				Array.last,
				Option.getOrElse(() => '')
			)
		),
		Match.when(Match.is('ts', 'tsx', 'js', 'jsx', 'javascript', 'typescript'), () => 'tsx' as const),
		Match.when(Match.is('sh', 'bash', 'zsh', 'shell'), () => 'shell' as const),
		Match.when(Match.is('md', 'markdown'), () => 'markdown' as const),
		Match.when(Match.is('json', 'jsonc', 'json5', 'lock'), () => 'jsonc' as const),
		Match.orElse(() => 'text' as const)
	)
}

export function highlightCode(code: string, lang?: string) {
	return highlighter.codeToHtml(code, {defaultColor: false, lang: resolveLanguage(lang), themes: HIGHLIGHT_THEMES})
}
