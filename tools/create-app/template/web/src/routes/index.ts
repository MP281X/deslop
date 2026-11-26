import {Command, Subscription, UiSchema} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Effect, Function, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {needsSignInCause} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {Account} from '@deslop/runtime/shared/schema'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {session} from '#lib/session.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}

const name = RpcClient.query('app.name', undefined)
const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const NameRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.String})
type Model = typeof Model.Type
const Model = Schema.Struct({account: AccountRead, name: NameRead, signInProblem: Schema.Option(Schema.String)})
const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	Name: {result: NameRead},
	Retry: {},
	SignIn: {},
	SignInDone: {problem: Schema.Option(Schema.String)}
})

const Retry = Command.make('App/Retry', {args: {}}, () =>
	Effect.map(AtomRegistry.AtomRegistry, registry => {
		if (Option.exists(AsyncResult.value(registry.get(session.account)), viewer => viewer.admin)) registry.refresh(name)
		registry.refresh(session.account)
	})
)

const SignIn = Command.make('App/SignIn', {args: {}}, () =>
	pipe(
		session.signIn,
		Effect.tap(signedIn => {
			if (!signedIn) return Effect.void
			return Effect.map(AtomRegistry.AtomRegistry, registry => registry.refresh(session.account))
		}),
		Effect.tapError(cause => Effect.logWarning('Auth could not open', cause)),
		Effect.match({
			onFailure: () => Message.SignInDone({problem: Option.some('Auth could not open. Try again.')}),
			onSuccess: () => Message.SignInDone({problem: Option.none()})
		})
	)
)

type H = Html.H<typeof Message.Type>

function Action(h: H, title: string, message: typeof Message.Type) {
	return Glass(h).children(Button(h).class('relative z-10 px-4 py-2').on('click', message).children(title))
}

function Status(h: H, model: Model) {
	if (AsyncResult.isFailure(model.account)) {
		if (needsSignInCause(model.account.cause)) return Action(h, 'Continue with GitHub', Message.SignIn())
		return Action(h, 'Retry account', Message.Retry())
	}
	if (Option.exists(AsyncResult.value(model.account), viewer => !viewer.admin)) {
		return h.span.children('Admin access required')
	}
	if (AsyncResult.isFailure(model.name)) return Action(h, 'Retry app name', Message.Retry())
	return Option.getOrElse(AsyncResult.value(model.name), Function.constant('Connecting…'))
}

export const App = Html.component({message: Message, model: Model, name: 'App'}).make({
	init: () => ({account: AsyncResult.initial(), name: AsyncResult.initial(), signInProblem: Option.none()}),
	subscriptions: context => [
		Subscription.make(
			'App/Account',
			Stream.map(Atom.toStream(session.account), result => Message.Account({result}))
		),
		Option.exists(AsyncResult.value(context.model.account), viewer => viewer.admin) &&
			Subscription.make(
				'App/Name',
				Stream.map(Atom.toStream(name), result => Message.Name({result}))
			)
	],
	update: {
		Account: ($, message) => $.evolve({account: message.result}),
		Name: ($, message) => $.evolve({name: message.result}),
		Retry: $ => $.run(Command.asNoop(Retry.make({}))),
		SignIn: $ => $.evolve({signInProblem: Option.none()}).run(SignIn.make({})),
		SignInDone: ($, message) => $.evolve({signInProblem: message.problem})
	},
	view: (h, model) =>
		h.main
			.class('grid min-h-dvh place-content-center gap-3')
			.children(
				h.img.class('size-8').attrs({alt: 'template-app', src: icon}),
				h.div.class('text-sm').attr('role', 'status').children(Status(h, model)),
				Option.match(model.signInProblem, {
					onNone: Function.constUndefined,
					onSome: problem => h.p.class('text-sm text-destructive').children(problem)
				})
			)
})
