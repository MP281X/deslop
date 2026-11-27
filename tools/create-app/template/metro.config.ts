import {NativeMetro} from '@effect/ui-native/node'

import {Boolean} from 'effect'

import ExpoMetro from 'expo/metro-config'

const ORIGIN = '#iphone/origin.ts'

const config = ExpoMetro.getDefaultConfig(import.meta.dirname)
const resolve = config.resolver.resolveRequest

// Leave the origin to Metro so Expo can inline EXPO_PUBLIC_APP_URL after the Effect UI prebundle.
config.resolver.resolveRequest = (context, name, platform) =>
	(resolve ?? context.resolveRequest)(
		context,
		Boolean.match(name === ORIGIN, {onFalse: () => name, onTrue: () => `${import.meta.dirname}/src/iphone/origin.ts`}),
		platform
	)

export default NativeMetro.withEffectUi(config, {external: [ORIGIN], platforms: ['ios']})
