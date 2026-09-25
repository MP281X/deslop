import {Match, pipe} from 'effect'

import {Braces, CirclePauseIcon, CircleIcon, File} from 'lucide-react'

import {BashDark} from './svgs/bashDark.tsx'
import {ClaudeDark} from './svgs/claudeDark.tsx'
import {CodexDark} from './svgs/codexDark.tsx'
import {EffectDark} from './svgs/effectDark.tsx'
import {MarkdownDark} from './svgs/markdownDark.tsx'
import {OpenaiDark} from './svgs/openaiDark.tsx'
import {OpencodeDark} from './svgs/opencodeDark.tsx'
import {OpenrouterDark} from './svgs/openrouterDark.tsx'
import {ReactDark} from './svgs/reactDark.tsx'
import {Spinner} from './ui/spinner.tsx'

import {resolveLanguage} from '#lib/shiki.ts'
import {cn} from '#lib/utils.ts'

export * from 'lucide-react'

export function AgentIcon(props: {layer: 'claude' | 'codex' | 'effect' | 'opencode'; className?: string}) {
	return pipe(
		Match.value(props.layer),
		Match.when('claude', () => <ClaudeDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('codex', () => <CodexDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('effect', () => <EffectDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('opencode', () => <OpencodeDark className={cn('size-3 shrink-0', props.className)} />),
		Match.exhaustive
	)
}

export function ProcessStateIcon(props: {
	state?: 'idle' | 'starting' | 'running' | 'waiting' | 'stopped' | 'exited' | 'failed'
	className?: string
}) {
	return pipe(
		Match.value(props.state),
		// oxlint-disable-next-line shadcn/no-restyle -- the starting spinner takes the primary color of the running dot, and Spinner has no color variant.
		Match.when('starting', () => <Spinner className={cn('text-primary size-3', props.className)} />),
		Match.when('running', () => <CircleIcon className={cn('fill-primary text-primary size-2.5', props.className)} />),
		Match.when('waiting', () => <CirclePauseIcon className={cn('text-chart-1 size-3', props.className)} />),
		Match.when(Match.is('failed', 'stopped'), () => (
			<CircleIcon className={cn('text-destructive fill-destructive size-2.5', props.className)} />
		)),
		Match.when('exited', () => (
			// oxlint-disable-next-line shadcn/no-raw-colors -- the exited state keeps its conventional green, and the theme has no green token.
			<CircleIcon className={cn('size-2.5 fill-emerald-500 text-emerald-500', props.className)} />
		)),
		Match.orElse(() => <CircleIcon className={cn('text-muted-foreground/70 size-2.5', props.className)} />)
	)
}

export function ProviderIcon(props: {provider: 'openai' | 'openrouter'; className?: string}) {
	return pipe(
		Match.value(props.provider),
		Match.when('openai', () => <OpenaiDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('openrouter', () => <OpenrouterDark className={cn('size-3 shrink-0', props.className)} />),
		Match.exhaustive
	)
}

export function FileIcon(props: {filePath: string; className?: string}) {
	return pipe(
		Match.value(resolveLanguage(props.filePath)),
		Match.when('shell', () => <BashDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('markdown', () => <MarkdownDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('tsx', () => <ReactDark className={cn('size-3 shrink-0', props.className)} />),
		Match.when('jsonc', () => <Braces className={cn('text-chart-1 size-3 shrink-0', props.className)} />),
		Match.when('text', () => <File className={cn('text-muted-foreground size-3 shrink-0', props.className)} />),
		Match.exhaustive
	)
}
