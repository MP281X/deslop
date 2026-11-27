declare const process: {
	readonly env: {
		readonly EXPO_PUBLIC_APP_URL?: string
		readonly EXPO_PUBLIC_AUTH_URL?: string
		readonly EXPO_PUBLIC_TRIPS_DEV?: string
	}
}

// Expo inlines direct EXPO_PUBLIC_* references at bundle time.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://trips.mp281x.xyz'
export const authOrigin = process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.mp281x.xyz'
export const development = process.env.EXPO_PUBLIC_TRIPS_DEV === '1'
export const scheme = development ? 'trips-dev' : 'trips'
export const bundle = development ? 'xyz.mp281x.trips.dev' : 'xyz.mp281x.trips'
export const sessionService = 'trips-auth'
export const sessionKey = 'auth.session'
export const keychainGroup = '99K7MQUK7F.group.' + bundle
