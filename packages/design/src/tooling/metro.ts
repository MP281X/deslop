import {NativeMetro} from '@effect/ui-native/node'

import {Boolean} from 'effect'

const ORIGIN = '#iphone/origin.ts'

export function iphoneMetro(config: NativeMetro.MetroConfig) {
	const resolve = config.resolver?.resolveRequest

	// Leave the origin to Metro so Expo can inline EXPO_PUBLIC_* after the Effect UI prebundle.
	function resolveRequest(
		context: {resolveRequest: NativeMetro.ResolveRequest},
		name: string,
		platform: string | null
	) {
		return (resolve ?? context.resolveRequest)(
			context,
			Boolean.match(name === ORIGIN, {onFalse: () => name, onTrue: () => `${config.projectRoot}/src/iphone/origin.ts`}),
			platform
		)
	}

	return NativeMetro.withEffectUi(
		{...config, resolver: {...config.resolver, resolveRequest}},
		{external: [ORIGIN], platforms: ['ios']}
	)
}
