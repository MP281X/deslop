import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

export const Tools = Toolkit.make(
	Tool.make('name', {description: "The app's package name.", success: Schema.Struct({name: Schema.String})}).annotate(
		Tool.Readonly,
		true
	)
)
