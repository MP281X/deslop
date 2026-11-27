import {NativeMetro} from '@effect/ui-native/node'

import ExpoMetro from 'expo/metro-config'

const config = ExpoMetro.getDefaultConfig(import.meta.dirname)
const resolve = config.resolver.resolveRequest
const origin = '#iphone/origin.ts'

// Leave the origin to Metro so Expo can inline EXPO_PUBLIC_APP_URL after the Effect UI prebundle.
config.resolver.resolveRequest = (context, name, platform) =>
	(resolve ?? context.resolveRequest)(
		context,
		name === origin ? `${import.meta.dirname}/src/iphone/origin.ts` : name,
		platform
	)

export default NativeMetro.withEffectUi(config, {external: [origin], platforms: ['ios']})
