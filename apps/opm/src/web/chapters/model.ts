import {Command, UiSchema} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Schema, pipe} from 'effect'

import {SystemBars} from '@capacitor/core'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {nativeSignIn, nativeSignOut} from '@deslop/ui/native'

import {
	ChapterIdentity,
	ChaptersError,
	ChapterKey,
	ChapterNumber,
	Position,
	ReadingChapter,
	ReadingPosition,
	Series
} from '#contracts'

import {chaptersAtom, readingWritesAtom} from '#web/chapters/catalogue.ts'
import {accountAtom, native} from '#web/platform.ts'
import {OpmRoute} from '#web/routes.ts'
import {RpcClient} from '#web/session.ts'

const CatalogueRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ReadingChapter)})
const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})

export type Reader = typeof Reader.Type
const Reader = Schema.Struct({
	bars: Schema.Boolean,
	expired: Schema.Boolean,
	finished: Schema.HashSet(ChapterNumber),
	inView: Schema.Option(ChapterNumber),
	page: Schema.UndefinedOr(Schema.Natural),
	strip: Schema.Array(ReadingChapter)
})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	authProblem: Schema.UndefinedOr(Schema.String),
	busy: Schema.Boolean,
	catalogue: CatalogueRead,
	failed: Schema.HashSet(Schema.String),
	listHidden: Schema.Boolean,
	menu: Schema.Boolean,
	narrow: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	reader: Schema.UndefinedOr(Reader),
	route: OpmRoute,
	spread: Schema.Boolean,
	unsaved: Schema.HashMap(ChapterKey, Position),
	wide: Schema.HashSet(Schema.String)
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {account: AccountRead},
	AuthDone: {problem: Schema.UndefinedOr(Schema.String)},
	Catalogue: {catalogue: CatalogueRead},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Close: {},
	CloseMenu: {},
	Expired: {chapter: ChapterIdentity},
	Image: {failed: Schema.Boolean, src: Schema.String, wide: Schema.Boolean},
	Menu: {},
	Move: {step: Schema.Literals([-1, 1])},
	Open: {chapter: ChapterIdentity},
	Posture: {narrow: Schema.Boolean},
	Retry: {},
	RetryPage: {src: Schema.String},
	Route: {route: OpmRoute},
	Series: {series: Series},
	Sidebar: {},
	SignIn: {},
	SignOut: {},
	Spread: {spread: Schema.Boolean},
	ToggleBars: {},
	Unsaved: {unsaved: Model.fields.unsaved}
})

export class Save extends Command.Service<Save>()('Opm/Save', {
	args: {updates: Schema.Array(ReadingPosition.json)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request => Effect.sync(() => registry.set(readingWritesAtom, request.updates))
		)
	)
}

function refresh(registry: AtomRegistry.AtomRegistry) {
	return Effect.sync(() => {
		registry.refresh(accountAtom)
		registry.refresh(chaptersAtom)
	})
}

export class Refresh extends Command.Service<Refresh>()('Opm/Refresh', {args: {}, success: Schema.Void}) {
	static readonly layer = this.toLayer(Effect.map(AtomRegistry.AtomRegistry, registry => () => refresh(registry)))
}

function restart(registry: AtomRegistry.AtomRegistry) {
	return Effect.andThen(
		Effect.sync(() => registry.refresh(RpcClient.runtime)),
		refresh(registry)
	)
}

export class SignIn extends Command.Service<SignIn>()('Opm/SignIn', {args: {}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => () =>
				pipe(
					nativeSignIn,
					Effect.tap(signedIn =>
						Boolean.match(signedIn, {onFalse: () => Effect.void, onTrue: () => restart(registry)})
					),
					Effect.match({
						onFailure: error => Message.AuthDone({problem: error.message}),
						onSuccess: () => Message.AuthDone({problem: undefined})
					})
				)
		)
	)
}

export class SignOut extends Command.Service<SignOut>()('Opm/SignOut', {args: {}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => () =>
				pipe(
					nativeSignOut,
					Effect.tap(() => restart(registry)),
					Effect.match({
						onFailure: error => Message.AuthDone({problem: error.message}),
						onSuccess: status =>
							Message.AuthDone({
								problem: Boolean.match(status >= 200 && status < 400, {
									onFalse: Function.constant('Auth did not confirm ending the shared session.'),
									onTrue: Function.constUndefined
								})
							})
					})
				)
		)
	)
}

export const OpmCommands = Layer.mergeAll(Save.layer, Refresh.layer, SignIn.layer, SignOut.layer)

export const SetBars = Command.make('Opm/SetBars', {args: {visible: Schema.Boolean}}, request => {
	if (!native) return Effect.void
	return Effect.ignore(
		Effect.tryPromise({
			catch: cause => ChaptersError.make({cause, message: 'The system bars could not be changed.'}),
			try: () =>
				Boolean.match(request.visible, {
					onFalse: () => SystemBars.hide({animation: 'NONE'}),
					onTrue: () => SystemBars.show({animation: 'NONE'})
				})
		}),
		{log: 'Warn', message: 'The system bars could not be changed'}
	)
})
