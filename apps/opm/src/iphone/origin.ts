declare const process: {
	readonly env: {
		readonly EXPO_PUBLIC_APP_URL?: string
		readonly EXPO_PUBLIC_AUTH_URL?: string
		readonly EXPO_PUBLIC_OPM_DEVELOPMENT?: string
	}
}

// Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://opm.mp281x.xyz'
export const authOrigin = process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.mp281x.xyz'
export const development = process.env.EXPO_PUBLIC_OPM_DEVELOPMENT === '1'

function appVariant() {
	if (development) return {bundle: 'xyz.mp281x.opm.dev', scheme: 'opm-dev'} as const
	return {bundle: 'xyz.mp281x.opm', scheme: 'opm'} as const
}

export const {bundle, scheme} = appVariant()
