import {Array, Boolean, Function, Option, Predicate, pipe} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Absent, PaneLeaf, Press, SheetOptions} from '@deslop/components/model'

import type {GatewayScreen} from '#app'

import type {AiProvider} from '#ai-proxy/contract.ts'
import type {KeyRow} from '#ai-proxy/screen.ts'
import {keyRow, keySheetOf} from '#ai-proxy/view.ts'
import {serverRow} from '#connections/view.ts'

export const ADD_LABEL = 'MCP server URL or provider key'
export const ADD_PLACEHOLDER = 'Paste a key or a server URL'

export function inputValue(payload: unknown) {
	if (Predicate.hasProperty(payload, 'value') && Predicate.isString(payload.value)) return payload.value
	return undefined
}

// The pieces the hosts draw differently: the provider's mark and the spend beside a key, the paste field and the key sheet, how rows sit in the page, and the sign-in the iPhone draws itself while the web leaves for it.
export type GatewayUi<H, C, S> = Components<H, C, S> & {
	cover: (host: H, provider: AiProvider) => PaneLeaf<C>
	entry: (host: H, id: string, row: C) => PaneLeaf<C>
	feedback: (host: H, text: string) => PaneLeaf<C>
	keySheet: (host: H, screen: GatewayScreen, actions: {cancel: C; save: C}) => SheetOptions<C> | Absent
	loading: (host: H, count: number, keys: boolean) => PaneLeaf<C>
	missing: (host: H, back: Press) => C
	page: (
		host: H,
		options: {
			feedback: PaneLeaf<C> | Absent
			field: PaneLeaf<C>
			notice: PaneLeaf<C> | Absent
			rows: readonly PaneLeaf<C>[]
			signIn: PaneLeaf<C> | Absent
		}
	) => C
	pasteField: (host: H, screen: GatewayScreen) => PaneLeaf<C>
	signIn?: (host: H, options: {press: Press; running: boolean; text: string}) => PaneLeaf<C>
	spend: (host: H, row: KeyRow) => PaneLeaf<C>
}

function rowsOf<H, C, S>(host: H, screen: GatewayScreen, ui: GatewayUi<H, C, S>) {
	function retryWhen(enabled: boolean) {
		if (enabled) return screen.retry
		return undefined
	}
	return Array.filter(
		[
			...Array.map(screen.keys.rows ?? [], row => keyRow(host, ui, row)),
			screen.keys.loading !== undefined && ui.loading(host, screen.keys.loading, true),
			screen.keys.problem !== undefined && ui.notice(host, screen.keys.problem, retryWhen(screen.keys.retry)),
			...Array.map(screen.servers.rows ?? [], row => serverRow(host, screen, ui, row)),
			screen.servers.loading !== undefined && ui.loading(host, screen.servers.loading, false),
			screen.servers.problem !== undefined && ui.notice(host, screen.servers.problem, retryWhen(screen.servers.retry)),
			screen.empty && ui.notice(host, 'No keys or MCP servers yet')
		],
		(child): child is PaneLeaf<C> => child !== false
	)
}

export function Workspace<H, C, S>(host: H, screen: GatewayScreen, ui: GatewayUi<H, C, S>) {
	if (screen.problem?.back === true) return ui.layout(host, {content: ui.missing(host, screen.back)})
	// Where the host draws its own sign-in, it replaces the rows once a read asks for one.
	const inPlace = Option.filter(
		Option.all({draw: Option.fromUndefinedOr(ui.signIn), problem: Option.fromUndefinedOr(screen.problem)}),
		found => found.problem.signIn
	)
	return ui.layout(host, {
		content: ui.page(host, {
			feedback: pipe(
				Option.fromUndefinedOr(screen.menuFeedback),
				Option.map(text => ui.feedback(host, text)),
				Option.getOrUndefined
			),
			field: ui.pasteField(host, screen),
			notice: pipe(
				Option.fromUndefinedOr(screen.signOutProblem),
				Option.filter(() => Option.isNone(inPlace)),
				Option.map(text => ui.notice(host, text)),
				Option.getOrUndefined
			),
			rows: rowsOf(host, screen, ui),
			signIn: pipe(
				inPlace,
				Option.map(found =>
					found.draw(host, {
						press: screen.authenticate,
						running: screen.signingIn,
						text: Boolean.match(screen.signingIn, {
							onFalse: () => screen.signOutProblem ?? found.problem.text,
							onTrue: Function.constant('Signing in…')
						})
					})
				),
				Option.getOrUndefined
			)
		}),
		sheet: keySheetOf(host, screen, ui),
		toolbar: screen.toolbar(ui.signIn === undefined)
	})
}
