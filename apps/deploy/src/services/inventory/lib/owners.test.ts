import {assert, it} from '@effect/vitest'

import {processOwner} from '#services/inventory/lib/owners.ts'

it("counts what a user's service starts in its own app slice, like T3 Code's agents, as that service", () => {
	const manager = '0::/user.slice/user-1000.slice/user@1000.service'
	assert.strictEqual(
		processOwner(
			`${manager}/app.slice/app-t3code.slice/app-t3code-agents.slice/app-t3code-agents-1.slice/t3code-claude-2.scope\n`
		),
		'service:user:t3code.service'
	)
	assert.strictEqual(processOwner(`${manager}/app.slice/t3code.service\n`), 'service:user:t3code.service')
	assert.strictEqual(
		processOwner(`${manager}/app.slice/app-org.chromium.Chromium-1.scope\n`),
		'service:system:user@1000.service'
	)
	assert.strictEqual(processOwner('0::/system.slice/app-other.slice/x.scope\n'), 'service:system:')
})
