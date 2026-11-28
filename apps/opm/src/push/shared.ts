declare const process: {readonly env: {readonly EXPO_PUBLIC_OPM_DEVELOPMENT?: string}}

// Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const development = process.env.EXPO_PUBLIC_OPM_DEVELOPMENT === '1'

// The link scheme a bundle's Live Activity opens.
export function schemeOf(bundle: string) {
	if (bundle === 'xyz.mp281x.opm') return 'opm'
	return 'opm-dev'
}

function appVariant() {
	if (development) return {bundle: 'xyz.mp281x.opm.dev', scheme: 'opm-dev'} as const
	return {bundle: 'xyz.mp281x.opm', scheme: 'opm'} as const
}

export const variant = appVariant()
