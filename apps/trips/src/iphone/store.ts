import {Effect, Option} from 'effect'

import {File, Paths} from 'expo-file-system'

import {FlightsError} from '#contracts'

import type {BoardCache} from '#screens/data.ts'

function disk(name: string): BoardCache {
	function change(run: (file: File) => void) {
		return Effect.ignore(
			Effect.try({
				catch: cause => FlightsError.make({cause, message: 'Trips could not update its offline board'}),
				try: () => run(new File(Paths.document, name))
			}),
			{log: 'Warn'}
		)
	}
	return {
		clear: change(file => {
			if (file.exists) file.delete()
		}),
		read: Effect.option(
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'Trips could not read its offline board'}),
				try: () => new File(Paths.document, name).text()
			})
		),
		write: text =>
			change(file => {
				if (!file.exists) file.create()
				file.write(text)
			})
	}
}

export const accountCache = disk('account.json')
export const flightCache = disk('flights.json')
