import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {AppVersion} from '@deslop/runtime/shared/schema'

import {refusal, restoreRefusal} from './policy.ts'

import {Exposure} from '#services/exposures/schema.ts'
import {ExposureName} from '#services/inventory/schema.ts'

function app(name: string, domain: Option.Option<string>) {
	return Option.some({
		auth: Option.map(domain, value => `https://auth.${value}`),
		name,
		traces: Option.none(),
		version: AppVersion.make('0.1.1')
	})
}

function exposure(name: string, hostname: string, port = 5104) {
	return {hostname, kind: 'public' as const, name: ExposureName.make(name), port}
}

function saved(owner: Option.Option<string>) {
	return Exposure.make({...exposure('web', 'web.example.com'), owner, state: 'active'})
}

const STASH = {owner: Option.some('user:deslop-stash.service'), runtime: app('stash', Option.some('example.com'))}

it('refuses Caddy’s admin port whatever listens on it', () => {
	assert.isTrue(
		Option.isSome(
			refusal(exposure('admin', 'admin.example.com', 20_219), {owner: Option.none(), runtime: Option.none()})
		)
	)
})

it('publishes a Deslop app only under its own name and hostname', () => {
	assert.isTrue(Option.isNone(refusal(exposure('stash', 'stash.example.com'), STASH)))
	assert.isTrue(Option.isSome(refusal(exposure('notes', 'stash.example.com'), STASH)))
	assert.isTrue(Option.isSome(refusal(exposure('stash', 'notes.example.com'), STASH)))
	assert.isTrue(Option.isNone(refusal({...exposure('stash', 'desktop.tail.ts.net'), kind: 'tailnet'}, STASH)))
})

it('refuses another app’s port, and an app that runs without a domain', () => {
	assert.isTrue(
		Option.isSome(
			refusal(exposure('stash', 'stash.example.com'), {
				owner: Option.some('user:deslop-auth.service'),
				runtime: app('auth', Option.some('example.com'))
			})
		)
	)
	assert.isTrue(
		Option.isSome(
			refusal(exposure('deploy', 'deploy.example.com'), {
				owner: Option.some('user:deslop-deploy.service'),
				runtime: app('deploy', Option.none())
			})
		)
	)
	// A preview names no Deslop unit but still answers as the app.
	assert.isTrue(
		Option.isSome(
			refusal(exposure('stash', 'stash.example.com'), {
				owner: Option.some('user:preview-stash.service'),
				runtime: app('stash', Option.none())
			})
		)
	)
})

it('refuses a Deslop unit that does not say how it runs, and publishes any other listener', () => {
	assert.isTrue(
		Option.isSome(
			refusal(exposure('stash', 'stash.example.com'), {
				owner: Option.some('user:deslop-stash.service'),
				runtime: Option.none()
			})
		)
	)
	assert.isTrue(
		Option.isNone(
			refusal(exposure('grafana', 'grafana.example.com'), {
				owner: Option.some('container:grafana'),
				runtime: Option.none()
			})
		)
	)
})

it('does not restore a row whose port now belongs to another owner, and checks a row saved without one only by policy', () => {
	const row = saved(Option.some('user:web.service'))
	const listener = {owner: Option.some('user:other.service'), runtime: Option.none()}
	assert.isTrue(Option.isSome(restoreRefusal(row, listener)))
	assert.isTrue(Option.isNone(restoreRefusal(row, {...listener, owner: Option.some('user:web.service')})))
	assert.isTrue(Option.isNone(restoreRefusal(row, {...listener, owner: Option.none()})))
	assert.isTrue(Option.isNone(restoreRefusal(saved(Option.none()), listener)))
})
