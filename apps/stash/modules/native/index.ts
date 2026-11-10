import {requireNativeModule} from 'expo'

export const native = requireNativeModule<{hasLink: () => PromiseLike<boolean>}>('StashNative')
