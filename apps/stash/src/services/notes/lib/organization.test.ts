import {assert, it} from '@effect/vitest'

import {Array, String} from 'effect'

import {fitPictures, fitText} from './organization.ts'

it('fits the texts into one budget and leaves a short one whole', () => {
	const fitted = fitText(String.repeat(500_000)('a'), 'short talk')
	assert.strictEqual(fitted.transcript, 'short talk')
	assert.isAtMost(String.length(fitted.content), 400_020)
	assert.isTrue(String.endsWith('[cut here]')(fitted.content))
	assert.isAtMost(String.length(fitText('a', String.repeat(200_000)('字')).transcript), 100_020)
})

function picture(label: string, bytes: number) {
	return {bytes: new Uint8Array(bytes), label, type: 'image/jpeg' as const}
}

it('keeps pictures in order until they fill the request', () => {
	assert.deepStrictEqual(
		Array.map(
			fitPictures([
				picture('preview', 1_000_000),
				picture('huge', 5_500_000),
				picture('slide', 4_000_000),
				picture('still', 2_000_000)
			]),
			image => image.label
		),
		['preview', 'slide']
	)
})
