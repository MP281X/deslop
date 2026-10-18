import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

export default defineConfig({
	...ViteConfig.config,
	pack: {
		...ViteConfig.pack,
		deps: {alwaysBundle: [/./u]},
		entry: {cli: 'src/main.cli.ts', server: 'src/main.server.ts'},
		outputOptions: {entryFileNames: '[name].js'}
	}
})
