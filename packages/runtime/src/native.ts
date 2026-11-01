import {argv} from 'node:process'

import {Config, Effect, Option, Path} from 'effect'

import {packageRoot} from '#cli/package.ts'

export const nativeTool = Effect.fnUntraced(function* (name: string) {
	const path = yield* Path.Path
	const configured = yield* Option.match(yield* Config.option(Config.String('APP_BIN')), {
		onNone: () => Effect.map(packageRoot(argv[1] ?? ''), root => path.join(root, 'bin')),
		onSome: Effect.succeed
	})

	return path.join(configured, name)
})
