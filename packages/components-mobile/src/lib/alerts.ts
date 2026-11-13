import {Effect} from 'effect'

import {Alert} from 'react-native'

// Shows a failure's message in a system alert under the title, then fails as before.
export function alertFailure<A, E extends {message: string}, R>(effect: Effect.Effect<A, E, R>, title: string) {
	return Effect.tapError(effect, error => Effect.sync(() => Alert.alert(title, error.message)))
}
