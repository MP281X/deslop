import {createModifier} from '@expo/ui/swift-ui/modifiers'
import {requireNativeModule} from 'expo'

export const native = requireNativeModule<{
	changeCount: () => number
	hasLink: () => PromiseLike<boolean>
	getSession: () => string
	setSession: (value: string) => void
	clearSession: () => void
	lockSession: () => PromiseLike<{backgroundTask: number; descriptor: number}>
	unlockSession: (lock: {backgroundTask: number; descriptor: number}) => PromiseLike<void>
}>('StashNative')

export const bottomBarSearch = createModifier('bottomBarSearch')
