import {defineRule} from '@oxlint/plugins'

export const noReadonlyTypeSyntax = defineRule({
	create: context => ({
		PropertyDefinition: node => {
			if (node.readonly === true) context.report({message: 'Remove the readonly type modifier.', node})
		},
		TSIndexSignature: node => {
			if (node.readonly) context.report({message: 'Remove the readonly index modifier.', node})
		},
		TSMappedType: node => {
			if (node.readonly === true || node.readonly === '+') {
				context.report({message: 'Remove the readonly mapped-type modifier.', node})
			}
		},
		TSParameterProperty: node => {
			if (node.readonly) context.report({message: 'Remove the readonly parameter-property modifier.', node})
		},
		TSPropertySignature: node => {
			if (node.readonly) context.report({message: 'Remove the readonly property modifier.', node})
		},
		TSTypeOperator: node => {
			if (node.operator === 'readonly') context.report({message: 'Use a mutable type shape.', node})
		}
	}),
	meta: {type: 'problem'}
})
