import {requireNativeModule, requireNativeView} from 'expo'

export const native = requireNativeModule<{hasLink: () => PromiseLike<boolean>; sharedUploads: () => string | null}>(
	'StashNative'
)

export const Logo = requireNativeView<{size: number; template?: boolean; uri: string}>('StashNative', 'Logo')
