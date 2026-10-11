import {requireNativeModule} from 'expo'

// What the clipboard holds, asked without reading it, so iOS shows no paste banner; see ios/StashPasteboardModule.swift.
export const pasteboard = requireNativeModule<{
	changeCount: () => number
	hasImage: () => boolean
	hasLink: () => PromiseLike<boolean>
}>('StashPasteboard')
