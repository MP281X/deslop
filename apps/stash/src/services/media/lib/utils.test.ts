import {assert, it} from '@effect/vitest'

import {Option, Schema} from 'effect'

import {captionTracks, captionTranscript, speechOnly} from '#services/media/lib/utils.ts'
import {Metadata} from '#services/media/schema.ts'

it('keeps authored alternatives and automatic captions in the original language', () => {
	assert.deepStrictEqual(
		captionTracks(
			Schema.decodeSync(Metadata)({
				automatic_captions: {af: [{}], en: [{}], 'en-orig': [{}], it: [{}]},
				subtitles: {it: [{}]},
				title: 'A talk'
			})
		),
		[
			{authored: false, language: 'en'},
			{authored: false, language: 'en-orig'},
			{authored: true, language: 'it'}
		]
	)
})

it('reads caption cue settings, markup and escapes', () => {
	assert.strictEqual(
		captionTranscript({
			authored: false,
			vtt: 'WEBVTT\n\n1\n00:00:10.000 --> 00:00:12.000 align:start\n<c>Tom &amp; Jerry</c> &lt;3'
		}),
		'[00:10] Tom & Jerry <3\n'
	)
})

it('keeps every cue line and collapses only the rolling overlap', () => {
	assert.strictEqual(
		captionTranscript({
			authored: false,
			vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nfirst line\nsecond line\n\n00:00:03.000 --> 00:00:05.000\nsecond line\nthird line'
		}),
		'[00:01] first line\n[00:01] second line\n[00:03] third line\n'
	)
	assert.strictEqual(
		captionTranscript({
			authored: true,
			vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYes.\n\n00:00:02.000 --> 00:00:03.000\nYes.'
		}),
		'[00:01] Yes.\n[00:02] Yes.\n'
	)
})

it('keeps a spoken transcript', () => {
	const speech =
		'[00:00] This app fixes MacBook limitations.\n[00:02] Normally you need Command-Q to quit an app.\n[00:06] With quit on close, hit the X and it closes completely.\n'
	assert.deepStrictEqual(speechOnly(speech), Option.some(speech))
})
