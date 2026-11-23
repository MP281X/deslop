import type {Record} from 'effect'

import {colors} from '@deslop/components-mobile/theme'

import {primary} from '#lib/session.ts'
import type {Tone} from '#services/flights/schema.ts'

export const tones = {
	bad: colors.destructive,
	good: primary,
	info: primary,
	plain: colors.mutedForeground,
	warn: colors.warning
} satisfies Record.ReadonlyRecord<Tone, unknown>
