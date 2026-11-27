import type {UserConfig} from 'vite-plus'

import {serverPack} from '@deslop/runtime/config/vite'

export default {
	build: {
		chunkSizeWarningLimit: 750,
		modulePreload: {polyfill: false},
		outDir: 'dist/client',
		rolldownOptions: {output: {codeSplitting: {groups: [{name: 'effect', test: /node_modules[\\/]effect[\\/]/u}]}}},
		target: 'esnext'
	},
	pack: serverPack(1024)
} satisfies UserConfig
