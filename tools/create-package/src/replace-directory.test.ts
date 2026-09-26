import {expect, it} from '@effect/vitest'

import {String} from 'effect'

import {replaceDirectory} from './replace-directory.ts'

it('replaces file contents inside folders and keeps file metadata', () => {
	expect(
		replaceDirectory(
			{'README.md': ['template-package'], bin: {'index.ts': ['template-package', {executable: true}]}},
			String.replaceAll('template-package', 'ledger')
		)
	).toEqual({'README.md': ['ledger'], bin: {'index.ts': ['ledger', {executable: true}]}})
})
