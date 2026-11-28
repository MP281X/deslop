import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {
	Array,
	Boolean,
	Context,
	DateTime,
	Effect,
	Function,
	Layer,
	MutableRef,
	Option,
	Predicate,
	Schema,
	Stream,
	pipe
} from 'effect'
import type {Duration} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import type {Absent} from '@deslop/components/model'

import {observe, refreshFailed} from '#client/atom.ts'
import {clockAtom} from '#client/clock.ts'
import {blockingFailure, isDeniedCause, needsSignInCause} from '#client/live-stream.ts'
import type {layerSocketProtocol} from '#client/protocol.ts'
import {AuthError} from '#shared/auth.ts'
import type {Account} from '#shared/schema.ts'
import {DateTimeUtcFromFiniteMillis} from '#shared/time.ts'

// What the host gives every app: the account, the socket that reopens after a sign-in, and the reads on screen.
function makeShell(
	protocol: ReturnType<typeof layerSocketProtocol>,
	account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>,
	autoSignIn: boolean
) {
	const credentialsAtom = Atom.make(0)
	return {
		account,
		autoSignIn,
		credentials: credentialsAtom,
		protocol: (get: Atom.AtomContext) => {
			get(credentialsAtom)
			return Layer.fresh(protocol)
		},
		reads: MutableRef.make(Array.empty<Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>>()),
		signInRequested: Atom.make(false)
	}
}

export class Shell extends Context.Service<Shell, ReturnType<typeof makeShell>>()('@deslop/runtime/client/shell') {}

export class Authenticate extends Command.Service<Authenticate>()('Shell/Authenticate', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {}

// Ends this device's session at Auth; the iPhone shell implements it, since a browser leaves through Auth's own page.
export class SignOutSession extends Command.Service<SignOutSession>()('Shell/SignOutSession', {
	args: {},
	error: AuthError
}) {}

export class OpenUrl extends Command.Service<OpenUrl>()('Shell/OpenUrl', {args: {url: Schema.String}}) {}

class Refresh extends Command.Service<Refresh>()('Shell/Refresh', {args: {authenticated: Schema.Boolean}}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const shell = yield* Shell
			const registry = yield* AtomRegistry.AtomRegistry
			return request =>
				Effect.sync(() => {
					registry.refresh(shell.account)
					// The session cookie is carried by the upgrade; reopen the socket after a successful sign-in.
					if (request.authenticated) {
						registry.update(shell.credentials, version => version + 1)
						return
					}
					Array.forEach(MutableRef.get(shell.reads), read => refreshFailed(registry, read))
				})
		})
	)
}

// The host's part of the shell: the account, the sockets and the registry the apps' reads and commands run on.
export function layerShell(...options: Parameters<typeof makeShell>) {
	return Layer.provideMerge(Refresh.layer, Layer.merge(Layer.succeed(Shell, makeShell(...options)), AtomRegistry.layer))
}

// An app's live read, which the shell retries when it fails and answers when the server asks for a sign-in.
export function observeRead<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	atom: Atom.Atom<A>,
	toMessage: (value: A) => M
) {
	return Stream.unwrap(
		Effect.gen(function* () {
			const shell = yield* Shell
			const registry = yield* AtomRegistry.AtomRegistry
			return pipe(
				observe(atom, Function.identity),
				Stream.tap(value =>
					Effect.sync(() => {
						if (AsyncResult.isFailure(value) && needsSignInCause(value.cause)) registry.set(shell.signInRequested, true)
					})
				),
				Stream.map(toMessage),
				Stream.onStart(Effect.sync(() => MutableRef.update(shell.reads, Array.append(atom)))),
				Stream.ensuring(
					Effect.sync(() =>
						MutableRef.update(
							shell.reads,
							Array.filter(held => held !== atom)
						)
					)
				)
			)
		})
	)
}

export type ReadState = typeof ReadState.Type
const ReadState = Schema.Literals(['failed', 'stale'])

// How reads stand: `failed` when one has nothing to show, `stale` when one failed but keeps its last value.
export function readState(reads: readonly AsyncResult.AsyncResult<unknown, unknown>[]) {
	if (Array.some(reads, read => Option.isSome(blockingFailure(read)))) return Option.some<ReadState>('failed')
	if (Array.some(reads, AsyncResult.isFailure)) return Option.some<ReadState>('stale')
	return Option.none<ReadState>()
}

const ShellMessage = UiSchema.TaggedEnum({
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Retry: {},
	SignIn: {},
	SignInFailed: {text: Schema.String},
	SignInRequested: {},
	SignedIn: {signedIn: Schema.Boolean}
})

function authenticate() {
	return pipe(
		Authenticate.make({}),
		Command.match({
			onFailure: error => ShellMessage.SignInFailed({text: error.message}),
			onSuccess: signedIn => ShellMessage.SignedIn({signedIn})
		})
	)
}

// The part of every app's screen that is not its own: the clock, the sign-in, the retry and the refusals. `view` draws the app and gets the parts to put in its screen.
function appShell(options: {readonly every: Duration.Input; readonly name: string}) {
	return Component.define({
		message: ShellMessage,
		model: Schema.Struct({
			authError: Schema.Option(Schema.String),
			now: DateTimeUtcFromFiniteMillis,
			redirected: Schema.Boolean
		}),
		name: `${options.name}Shell`
	}).make({
		init: () => ({authError: Option.none(), now: DateTime.nowUnsafe(), redirected: false}),
		parts: (p, model) => ({
			authenticate: p.part((el, event: string) => el.on(event, ShellMessage.SignIn())),
			now: model.now,
			// The problem that replaces the screen: a sign-in the server asks for, or an account it refuses.
			problem: (reads: readonly AsyncResult.AsyncResult<unknown, unknown>[]) => {
				if (Array.some(reads, read => AsyncResult.isFailure(read) && needsSignInCause(read.cause))) {
					return {
						signIn: true,
						text: Option.getOrElse(model.authError, Function.constant(`Sign in to ${options.name}`))
					}
				}
				if (Array.some(reads, read => AsyncResult.isFailure(read) && isDeniedCause(read.cause))) {
					return {signIn: false, text: 'Access denied'}
				}
				return undefined
			},
			retry: p.part((el, event: string) => el.on(event, ShellMessage.Retry())),
			signingIn: p.isRunning(Authenticate)
		}),
		subscriptions: () => [
			Subscription.make(
				'clock',
				observe(clockAtom(options.every), now => ShellMessage.Clock({now}))
			),
			Subscription.make(
				'signIn',
				Stream.unwrap(
					Effect.map(Shell, shell =>
						Boolean.match(shell.autoSignIn, {
							onFalse: () => Stream.empty,
							onTrue: () =>
								pipe(
									observe(shell.signInRequested, Function.identity),
									Stream.filter(Function.identity),
									Stream.map(() => ShellMessage.SignInRequested())
								)
						})
					)
				)
			)
		],
		update: {
			Clock: ($, message) => $.evolve({now: message.now}),
			Retry: $ => $.run(Command.asNoop(Refresh.make({authenticated: false}))),
			SignIn: $ => $.evolve({authError: Option.none()}).run(authenticate()),
			SignInFailed: ($, message) => $.evolve({authError: Option.some(message.text)}),
			SignInRequested: $ => {
				if ($.model.redirected) return $.model
				return $.evolve({redirected: true}).run(authenticate())
			},
			SignedIn: ($, message) => {
				if (!message.signedIn) return $.model
				return $.run(Command.asNoop(Refresh.make({authenticated: true})))
			}
		}
	})
}

export type RouteValue = {readonly _tag: string}

// Back from an item: to the home route from any other, to the page before when the list is behind the item, else to the list.
export function goBack(
	model: {readonly hasListBehind: boolean; readonly route: RouteValue},
	home: RouteValue,
	list: Readonly<Record<string, unknown>>
) {
	if (!Predicate.isTagged(model.route, home._tag)) return Command.asNoop(Router.Replace.make({route: home}))
	if (model.hasListBehind) return Command.asNoop(Router.Back.make({}))
	return Command.asNoop(Router.PatchSearch.make({history: 'replace', patch: list, route: model.route, scroll: false}))
}

// Opening an item from the list pushes a page; from another item it replaces the page.
export function openItem<Route extends RouteValue>(
	route: Route,
	isOpen: (route: Route) => boolean,
	patch: Readonly<Record<string, unknown>>
) {
	return Command.asNoop(
		Router.PatchSearch.make({
			history: Boolean.match(isOpen(route), {
				onFalse: Function.constant('push' as const),
				onTrue: Function.constant('replace' as const)
			}),
			patch,
			route,
			scroll: false
		})
	)
}

// The detail slides in as an item opens and out as it closes.
export function slide<Route extends RouteValue, Step extends {viewTransition: (types?: readonly string[]) => Step}>(
	step: Step,
	isOpen: (route: Route) => boolean,
	from: Route,
	to: Route
) {
	if (isOpen(to) && !isOpen(from)) return step.viewTransition(['design-detail-in'])
	if (!isOpen(to) && isOpen(from)) return step.viewTransition(['design-detail-out'])
	return step
}

// Whether the list stays one step behind the item: it does once the item opened from it.
export function listBehind<Route extends RouteValue>(
	model: {readonly hasListBehind: boolean; readonly route: Route},
	isOpen: (route: Route) => boolean
) {
	return model.hasListBehind || !isOpen(model.route)
}

// The parts that select an item in a list and go back from it.
export function selection<Msg, Props, V extends View.Elements>(
	p: Component.PartsHelper<Msg, Props, V>,
	input: {
		readonly back: Msg
		readonly id: string | Absent
		readonly open: boolean
		readonly select: (id: string) => Msg
	}
) {
	return {
		back: p.part((el, event: string) => el.on(event, input.back)),
		id: Boolean.match(input.open, {onFalse: Function.constUndefined, onTrue: Function.constant(input.id)}),
		select: p.part((el, event: string, id: string) => el.on(event, input.select(id)))
	}
}

export type ScreenParts = {
	readonly reads: readonly AsyncResult.AsyncResult<unknown, unknown>[]
	readonly routeMissing: boolean
}

// The shell's refusals and sign-in come first, then a route the screen does not answer.
function problemOf(screen: ScreenParts, shell: Component.Headless.Parts<ReturnType<typeof appShell>>, missing: string) {
	const refusal = shell.problem(screen.reads)
	if (refusal !== undefined) return {...refusal, back: false}
	if (screen.routeMissing) return {back: true, signIn: false, text: missing}
	return undefined
}

// What an app's views draw from: its screen, the shell's parts, and the one problem that replaces the screen.
export type AppScreen<Parts extends ScreenParts> = Parts &
	Omit<Component.Headless.Parts<ReturnType<typeof appShell>>, 'problem'> & {
		readonly problem: ReturnType<typeof problemOf>
	}

// An app's root: the shell around its one screen, which takes the route as a prop beside the shell's clock.
export function shellApp<
	Props extends {readonly route: {readonly _tag: string}},
	Parts extends ScreenParts,
	Needs
>(options: {
	readonly every: Duration.Input
	readonly missing: string
	readonly name: string
	readonly props: Schema.Codec<Props, unknown>
	readonly screen: Component.Headless<{readonly now: DateTime.Utc; readonly route: Props['route']}, never, Parts, Needs>
}) {
	const AppShell = appShell(options)
	return function App<V extends View.Elements, R>(
		elements: View.Vocabulary<V>,
		view: (h: View.WithTags<never, unknown, V>, screen: AppScreen<Parts>) => View.Content<never, R>
	) {
		return Component.withElements(elements)({
			message: Schema.Never,
			model: Schema.Null,
			name: 'App',
			props: options.props
		}).make({
			init: Function.constNull,
			update: Function.constNull,
			view: h =>
				AppShell(h, {
					view: shell =>
						options.screen(h, {
							props: {now: shell.now, route: h.props.route},
							view: screen => view(h, {...screen, ...shell, problem: problemOf(screen, shell, options.missing)})
						})
				})
		})
	}
}
