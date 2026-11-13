import {defineRule} from 'vite-plus/lint/plugins'

export const noCompilerOptOut = defineRule({
	create: context => ({
		ExpressionStatement: node => {
			if (node.directive !== 'use no memo' && node.directive !== 'use no forget') return
			context.report({
				fix: fixer => fixer.remove(node),
				message: 'Remove this directive, rerun lint and fix the React Compiler diagnostic it hid.',
				node
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [{'sample.tsx': 'export function Title(props: {text: string}) { return <span>{props.text}</span> }'}],
				fixes: [
					{
						'sample.tsx': `export function Title(props: {text: string}) { 'use no memo'; return <span>{props.text}</span> }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
