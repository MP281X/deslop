import {createModifier, createModifierWithEventListener} from '@expo/ui/swift-ui/modifiers'

// ios/DeslopComponentsModule.swift: the search field in the middle of the bottom bar, between the toolbar's own items.
export const bottomBarSearch = createModifier('bottomBarSearch')

// ios/DeslopComponentsModule.swift: the navigation bar stays whole on a screen with nothing to scroll.
export const barNeverMinimizes = createModifier('barNeverMinimizes')

// ios/DeslopComponentsModule.swift: whether the field of the `searchable` before it has focus, and so the keyboard.
export function onSearchFocusChange(handler: (focused: boolean) => void) {
	return createModifierWithEventListener('onSearchFocusChange', (event: {focused: boolean}) => handler(event.focused))
}
