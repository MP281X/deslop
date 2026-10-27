import {fileURLToPath} from 'node:url'

import type {ExpoConfig} from 'expo/config'
import {withPlugins} from 'expo/config-plugins'

function path(specifier: string) {
	return fileURLToPath(import.meta.resolve(specifier))
}

// The theme names JetBrains Mono, so every app that uses this package registers its files.
export function plugin(config: ExpoConfig) {
	return withPlugins(config, [
		[
			path('expo-font/app.plugin.js'),
			{
				fonts: [
					path('@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf'),
					path('@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf')
				]
			}
		]
	])
}
