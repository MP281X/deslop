import {Console, Effect, FileSystem, Path} from 'effect'

import {CliError} from 'effect/cli'

export const copyTemplate = Effect.fnUntraced(function* (input: {
	from: string
	rewrite: (content: string) => string
	to: string
}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	if (yield* fs.exists(input.to)) {
		return yield* CliError.UserError.make({cause: input.to, userMessage: `${input.to} already exists.`})
	}
	yield* Effect.forEach(
		yield* fs.readDirectory(input.from, {recursive: true}),
		entry =>
			Effect.gen(function* () {
				const from = path.join(input.from, entry)
				const to = path.join(input.to, entry)
				if ((yield* fs.stat(from)).type === 'Directory') return
				yield* fs.makeDirectory(path.dirname(to), {recursive: true})
				if (path.extname(entry) === '.png') return yield* fs.copyFile(from, to)
				yield* fs.writeFileString(to, input.rewrite(yield* fs.readFileString(from)))
			}),
		{concurrency: 'unbounded'}
	)
	yield* Console.log(`Created ${input.to}`)
})
