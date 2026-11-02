import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

export default defineConfig({
	...ViteConfig.config,
	run: {
		tasks: {
			build: {
				// The marks glob lists every app's directory, which their own builds change; the icons it reads stay inputs.
				cache: {
					input: [
						{auto: true},
						{base: 'workspace', pattern: '!apps/*'},
						{base: 'workspace', pattern: '!apps/*/dist'},
						{base: 'workspace', pattern: '!apps/*/dist/**'}
					]
				},
				command: 'vp build && vp pack'
			}
		}
	}
})
