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
const development = process.env.EXPO_PUBLIC_TRIPS_DEV === '1'
export function tripsVariant<A>(release: A, sandbox: A) {
	if (development) return sandbox
	return release
}

export const scheme = tripsVariant('trips', 'trips-dev')
export const bundle = tripsVariant('xyz.mp281x.trips', 'xyz.mp281x.trips.dev')
export const sessionService = 'trips-auth'
export const sessionKey = 'auth.session'
export const keychainGroup = `99K7MQUK7F.group.${bundle}`
