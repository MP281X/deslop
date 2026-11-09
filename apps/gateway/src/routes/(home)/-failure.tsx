import {Schema} from 'effect'

import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {AuthError} from '@deslop/runtime/auth/schema'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

export function FailureContent(props: {error: unknown; reset: () => void}) {
	if (!Schema.is(AuthError)(props.error)) return <Error error={props.error} reset={props.reset} />
	if (props.error.error === 'access_denied') {
		return <Error error={props.error} label="Access denied" reset={props.reset} />
	}
	if (!needsSignIn(props.error)) return <Error error={props.error} reset={props.reset} />
	return <SignIn href={signInUrl(location.href)} />
}
