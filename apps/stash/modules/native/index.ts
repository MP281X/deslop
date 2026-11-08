import {requireNativeModule} from 'expo'

export const native = requireNativeModule<{
	hasLink: () => PromiseLike<boolean>
	getSession: () => string
	setSession: (value: string) => void
	clearSession: () => void
}>('StashNative')
