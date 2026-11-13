import {Effect, FileSystem, Path} from 'effect'

// Keep generated members and their fixtures outside the live workspace's discovery globs, even if the runner is killed.
export const testWorkspace = Effect.fnUntraced(function* (root: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const workspace = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-generator-'})
	for (const directory of ['apps', 'packages', 'tools']) {
		yield* fs.makeDirectory(path.join(workspace, directory))
	}
	for (const file of ['.fallowrc.json', '.gitignore', 'vite.config.ts', 'package.json', 'pnpm-workspace.yaml']) {
		yield* fs.copyFile(path.join(root, file), path.join(workspace, file))
	}
	for (const directory of [
		'node_modules',
		'packages/runtime',
		'packages/components-web',
		'packages/components-mobile',
		'tools/coding-standards'
	]) {
		yield* fs.symlink(path.join(root, directory), path.join(workspace, directory))
	}
	for (const tool of ['create-app', 'create-package']) {
		const directory = path.join('tools', tool)
		yield* fs.makeDirectory(path.join(workspace, directory))
		for (const file of ['bin', 'src', 'template', 'package.json']) {
			yield* fs.copy(path.join(root, directory, file), path.join(workspace, directory, file))
		}
		yield* fs.symlink(path.join(root, directory, 'node_modules'), path.join(workspace, directory, 'node_modules'))
	}
	return workspace
})
