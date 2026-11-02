import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

export function PageError(props: {error: unknown}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	return <Error error={props.error} reset={() => location.reload()} />
}
