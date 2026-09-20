import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {memberName} from './shared.ts'

const mockingCalls = [
	'jest.mock',
	'jest.spyOn',
	'vi.doMock',
	'vi.hoisted',
	'vi.importMock',
	'vi.mock',
	'vi.spyOn',
	'vi.unmock'
]

function isModuleMockingCall(node: ESTree.CallExpression) {
	if (node.callee.type !== 'MemberExpression' || node.callee.object.type !== 'Identifier') return false
	const owner = node.callee.object.name
	return Option.exists(memberName(node.callee), name => Array.contains(mockingCalls, `${owner}.${name}`))
}

export const noModuleMocking = defineRule({
	create: context => ({
		CallExpression: node => {
			if (isModuleMockingCall(node)) {
				context.report({message: 'A Layer is the seam; never mock a module.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
