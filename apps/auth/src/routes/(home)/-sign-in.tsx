import {Option} from 'effect'

import {getRouteApi} from '@tanstack/react-router'

import {ThemedMark} from '@deslop/components-web/blocks/marks'
import {Button} from '@deslop/components-web/ui/button'
import {FieldError} from '@deslop/components-web/ui/field'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'

import type {Search} from '#lib/auth.ts'

const route = getRouteApi('/(home)')
// A sign-in GitHub could not finish returns here with its reason; pressing the button starts a new one.
export function SignIn() {
	const search: Search = route.useSearch()
	return (
		<section className="m-auto flex w-full flex-col gap-5 sm:max-w-80" aria-label="Sign in">
			<Button
				size="lg"
				onClick={() =>
					location.assign(
						`/sign-in?${new URLSearchParams({next: Option.getOrElse(search.next, () => location.origin)})}`
					)
				}
			>
				<ThemedMark light={GithubDark} dark={GithubLight} />
				Continue with GitHub
			</Button>
			<FieldError>{Option.getOrUndefined(search.error)}</FieldError>
		</section>
	)
}
