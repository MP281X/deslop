import {createModifier} from '@expo/ui/swift-ui/modifiers'
import {requireNativeModule} from 'expo'

export const pasteboard = requireNativeModule<{changeCount: () => number; hasLink: () => PromiseLike<boolean>}>(
	'StashNative'
)

export const bottomBarSearch = createModifier('bottomBarSearch')
