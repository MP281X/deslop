import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// Transformers.js loads native ONNX Runtime binaries, so it stays an installed dependency.
		deps: {alwaysBundle: [/^(?!@huggingface\/transformers)/u]},
		entry: ['src/cli.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
