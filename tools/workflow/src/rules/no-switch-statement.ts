import {defineRule} from '@oxlint/plugins'

export const noSwitchStatement = defineRule({
	create: context => ({
		SwitchStatement: node => {
			context.report({message: 'Use Match instead of switch.', node})
		}
	}),
	meta: {type: 'problem'}
})
