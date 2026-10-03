import {Array, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {importedMember, isReactUseState} from '#rules/shared.ts'

export const noRedundantStateType = defineRule({
	create: context => ({
		CallExpression: node => {
			const argument = node.arguments[0]
			const type = node.typeArguments?.params[0]
			if (
				node.arguments.length !== 1 ||
				node.typeArguments?.params.length !== 1 ||
				argument?.type !== 'Literal' ||
				node.callee.type === 'Super'
			) {
				return
			}
			if (
				!(
					isReactUseState({context, node}) ||
					Array.some(['MutableRef', 'Ref', 'SubscriptionRef'], importedName =>
						importedMember({context, importedName, node: node.callee, propertyName: 'make'})
					)
				)
			) {
				return
			}
			if (
				(Predicate.isString(argument.value) && type?.type === 'TSStringKeyword') ||
				(Predicate.isNumber(argument.value) && type?.type === 'TSNumberKeyword') ||
				(Predicate.isBoolean(argument.value) && type?.type === 'TSBooleanKeyword')
			) {
				context.report({message: 'Drop this state type; the initializer infers the same primitive type.', node: type})
			}
		}
	}),
	meta: {type: 'problem'}
})
