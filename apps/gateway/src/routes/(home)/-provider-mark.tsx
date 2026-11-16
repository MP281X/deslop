import {Match, pipe} from 'effect'

import {ThemedMark} from '@deslop/components-web/blocks/marks'
import {AnthropicBlack} from '@deslop/components-web/ui/svgs/anthropicBlack'
import {AnthropicWhite} from '@deslop/components-web/ui/svgs/anthropicWhite'
import {Openai} from '@deslop/components-web/ui/svgs/openai'
import {OpenaiDark} from '@deslop/components-web/ui/svgs/openaiDark'
import {Opencode} from '@deslop/components-web/ui/svgs/opencode'
import {OpencodeDark} from '@deslop/components-web/ui/svgs/opencodeDark'

import type {AiProvider} from '#services/ai-proxy/schema.ts'

export function ProviderMark(props: {provider: AiProvider}) {
	return pipe(
		props.provider,
		Match.value,
		Match.when('anthropic', () => <ThemedMark light={AnthropicBlack} dark={AnthropicWhite} className="size-4" />),
		Match.when('openai', () => <ThemedMark light={Openai} dark={OpenaiDark} className="size-4" />),
		Match.when('opencode', () => <ThemedMark light={Opencode} dark={OpencodeDark} className="size-4" />),
		Match.exhaustive
	)
}
