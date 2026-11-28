import type {GatewayScreen} from '#app'
import type {GatewayUi} from '#view'

import type {KeyRow} from './screen.ts'

export const KEY_LABEL = 'OpenCode, Anthropic or OpenAI key'
export const KEY_FORM = 'gateway-key-form'

// The provider marks rasterized for Fabric’s image host.
export const marks = {
	anthropic:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAABlBMVEUAAAD///+l2Z/dAAAAAXRSTlMAQObYZgAAAIdJREFUSMft1EEOwCAIRFH+/S/dTZNWHQdc2HZRdiAvkWCM+OODwRkqc/1nD5mARTGA7FLbAQzCDoEAVmDFGwCkmA5xHRTFrVy71L28BaCAGcJeW4mulI/tX5ADxW2DFcMQsChSEE+D/lTUmlS0+81oYJan+82bXQSQASYgpqARlX+nSeOPQhyJgAN2i4FPjAAAAABJRU5ErkJggg==',
	openai:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAABlBMVEUAAAD///+l2Z/dAAAAAXRSTlMAQObYZgAAALlJREFUSMftlEsOhEAIROH+l3YShanqBpp2YVzIZqJTj7+IfPZa059tyjcQk7Yp12gvEukb5djfoCsJyH92khfsCvvRXH4B/2cEo3pPwDNhD1F/HMBxrAEaQDYLc+jeNWhxCgz97AIYpAayRodFY8bKjsIQ0gdmQpcAIZR+CuCwFEcpIUBBsIZyN4Azbb7fnFnQ6LBNQptR3YHxw9TpZU5ovXgjQTdDZEFQlZ3bB8Tmhb1xwzfknz1sB7lgAXbWDSmJAAAAAElFTkSuQmCC',
	opencode:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAzFBMVEUTEBASDw8RDg4WExMrKSkvLCwtKioXFRXJyMjk4+Pi4uLj4+PT0tI3NDQQDQ3////t7e08OTn9/f3w8PDt7Ozv7+/8/PxeXFw6Nzc6ODhTUVHn5+cNCgoOCwvi4eE7OTkPDAwuLCxDQUEYFhYbGBgZFhY2NDTx8fFvbm5PTU1RT09QTU1mZGTq6eny8vJ3dXVYVlZaWFhZV1dubGzr6up2dXVtbGx1dHRWVFRXVVVsamr08/OHhYV/fX3u7u7q6urc3Nw5NjY8OjoaFxdQhDe6AAAAx0lEQVRIx+3V2Q7BQBSAYS1t6WZKUfu+b0UVRSnv/05uDpGYSY6kgqTf5cz5L89MLBb5MI5n4Bjz8YRAJUr0gk8kUzKFomo6PRDkNBUx/i3IZE0CzFweEWQLlgGKpTIiMK2KDqpiDRE8Xb+ehBPUGxzQm6ig1e6Abk9BBP3BcATGkykimM3tBViuHEywfgS2GwXfCzZbG+w8TLA/eC7wjgSzov7JuSOYFf3BZ+aNQFR9QuGfA3rASdrFoLgEV9YHoTMw5iPhuQFhXEtWW3wiVgAAAABJRU5ErkJggg=='
}

export function keyRow<H, C, S>(host: H, ui: GatewayUi<H, C, S>, row: KeyRow) {
	return ui.entry(
		host,
		row.item.id,
		ui.row(host, {active: false, cover: ui.cover(host, row.provider), item: row.item, trailing: ui.spend(host, row)})
	)
}

// The sheet that saves a key: the web submits its form from the sheet's own actions, the iPhone presses them inside it.
export function keySheetOf<H, C, S>(host: H, screen: GatewayScreen, ui: GatewayUi<H, C, S>) {
	if (screen.dialog === undefined) return undefined
	return ui.keySheet(host, screen, {
		cancel: ui.button(host, {disabled: screen.busy, label: 'Cancel', press: screen.cancel}),
		save: ui.button(host, {
			disabled: screen.busy || !screen.dialog.valid,
			form: KEY_FORM,
			label: screen.dialog.action,
			press: screen.save
		})
	})
}
