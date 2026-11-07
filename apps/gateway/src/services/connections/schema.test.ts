import {assert, it} from '@effect/vitest'

import {Schema} from 'effect'

import {Metadata} from '#services/connections/schema.ts'

it('validates every OAuth endpoint as part of metadata decoding', () => {
	const metadata = {
		authorization_endpoint: 'https://provider.example/authorize?tenant=one',
		issuer: 'https://provider.example',
		registration_endpoint: 'https://provider.example/register',
		token_endpoint: 'https://provider.example/token'
	}
	assert.isTrue(Schema.is(Metadata)(metadata))
	for (const key of ['authorization_endpoint', 'issuer', 'registration_endpoint', 'token_endpoint']) {
		for (const value of [
			'http://provider.example',
			'javascript:alert(1)',
			'/relative',
			'https://user:pass@provider.example',
			'https://provider.example#fragment'
		]) {
			assert.isFalse(Schema.is(Metadata)({...metadata, [key]: value}))
		}
	}
})
