import {Array, Option, Record, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {matches} from '#rules/shared.ts'

const primitives: Record<string, string> = {button: 'Button', input: 'Input', select: 'Select', textarea: 'Textarea'}

const controlStyle =
	/(?:^|:)(?:hover|focus|focus-visible|active):|(?:^|:)(?:rounded|shadow|ring)(?:-|$)|(?:^|:)p[blrtxy]?-(?!0$)|(?:^|:)bg-(?!transparent$)|(?:^|:)border(?:-[blrtxy])?$|(?:^|:)border-(?!0$|[blrtxy]-0$)/u

export const noNativeControl = defineRule({
	create: context => ({
		JSXOpeningElement: node => {
			if (node.name.type !== 'JSXIdentifier') return
			const name = node.name.name
			Option.map(Record.get(primitives, name), primitive => {
				const styled = pipe(
					node.attributes,
					Array.findFirst(
						attribute =>
							attribute.type === 'JSXAttribute' &&
							attribute.name.type === 'JSXIdentifier' &&
							attribute.name.name === 'className'
					),
					Option.flatMap(attribute =>
						attribute.type === 'JSXAttribute' && attribute.value?.type === 'Literal'
							? Option.fromNullishOr(attribute.value.value)
							: Option.none()
					),
					Option.exists(value => Array.some(String.split(value, /\s+/u), matches(controlStyle)))
				)
				if (name !== 'select' && !styled) return
				context.report({message: `Use the ${primitive} UI primitive instead of a styled native control.`, node})
			})
		}
	}),
	meta: {type: 'problem'}
})
