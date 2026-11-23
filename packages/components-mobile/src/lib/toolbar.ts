import {createModifier, createModifierWithEventListener} from '@expo/ui/swift-ui/modifiers'

// ios/DeslopComponentsModule.swift: the search field in the middle of the bottom bar, between the toolbar's own items.
export const bottomBarSearch = createModifier('bottomBarSearch')

// ios/DeslopComponentsModule.swift: the navigation bar stays whole on a screen with nothing to scroll.
export const barNeverMinimizes = createModifier('barNeverMinimizes')

// ios/DeslopComponentsModule.swift: whether the field of the `searchable` before it has focus, and so the keyboard; `focused` false ends the focus and keeps the query.
export function searchFocused(focused: boolean, onChange: (focused: boolean) => void) {
	return createModifierWithEventListener('searchFocused', (event: {focused: boolean}) => onChange(event.focused), {
		focused
	})
}
