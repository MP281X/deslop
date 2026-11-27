import {Effect} from 'effect'

import {File, Paths} from 'expo-file-system'

import {FlightsError} from '#contracts'

import type {BoardCache} from '#screens/data.ts'

function disk(name: string) {
	function change(run: (file: File) => void) {
		return Effect.try({
			catch: cause => FlightsError.make({cause, message: 'Trips could not update its offline board'}),
			try: () => run(new File(Paths.document, name))
		})
	}
	const remove = change(file => {
		if (file.exists) file.delete()
	})
	const cache = {
		clear: Effect.ignore(remove, {log: 'Warn'}),
		read: Effect.option(
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'Trips could not read its offline board'}),
				try: () => new File(Paths.document, name).text()
			})
		),
		write: text =>
			Effect.ignore(
				change(file => {
					if (!file.exists) file.create()
					file.writeSync(text)
				}),
				{log: 'Warn'}
			)
	} satisfies BoardCache
	return {...cache, remove}
}

export const accountCache = disk('account.json')
export const flightCache = disk('flights.json')
