import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

export const noDiscardedFailure = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!importedMember({context, importedName: 'Effect', node})) return
			if (!Option.exists(memberName(node), name => Array.contains(['ignore', 'orDie', 'orDieWith'], name))) return
			context.report({
				message:
					"Map the failure to the service's error; an expected failure is never ignored or turned into a defect.",
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
