declare const process: {readonly env: {readonly EXPO_PUBLIC_APP_URL?: string}}

// Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://portfolio.mp281x.xyz'
export const scheme = 'portfolio'
