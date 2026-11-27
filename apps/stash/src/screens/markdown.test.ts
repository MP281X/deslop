import {assert, it} from '@effect/vitest'

import {webLinksOnly} from '#screens/markdown.ts'

it('keeps web links and turns any other destination into its text', () => {
	assert.strictEqual(
		webLinksOnly('- [Docs](https://example.com/a) and [call](tel:123), [app](shortcuts://run) <sms:1> <https://x.com>'),
		'- [Docs](https://example.com/a) and call, app sms:1 <https://x.com>'
	)
})
