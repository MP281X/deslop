import {Option} from 'effect'

import {getRouteApi} from '@tanstack/react-router'

import {ThemedMark} from '@deslop/components-web/blocks/marks'
import {Button} from '@deslop/components-web/ui/button'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'

import type {Search} from '#lib/auth.ts'

const route = getRouteApi('/(home)')
export function SignIn() {
	const next = route.useSearch({select: (search: Search) => search.next})
	return (
		<section className="m-auto flex w-full flex-col gap-5 sm:max-w-80" aria-label="Sign in">
			<Button
				size="lg"
				onClick={() =>
					location.assign(`/sign-in?${new URLSearchParams({next: Option.getOrElse(next, () => location.origin)})}`)
				}
			>
				<ThemedMark light={GithubDark} dark={GithubLight} />
				Continue with GitHub
			</Button>
		</section>
	)
}
