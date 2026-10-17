import {defineRule} from '@oxlint/plugins'

export const noSwitchStatement = defineRule({
	create: context => ({
		SwitchStatement: node => {
			context.report({
				message: 'Use pipe(Match.value(x), Match.tag(...) or Match.when(...), Match.exhaustive) instead of switch.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
