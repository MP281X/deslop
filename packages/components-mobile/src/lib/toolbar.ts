import {createModifier} from '@expo/ui/swift-ui/modifiers'

// ios/DeslopComponentsModule.swift: the search field in the middle of the bottom bar, between the toolbar's own items.
export const bottomBarSearch = createModifier('bottomBarSearch')

// ios/DeslopComponentsModule.swift: the navigation bar stays whole on a screen with nothing to scroll.
export const barNeverMinimizes = createModifier('barNeverMinimizes')
