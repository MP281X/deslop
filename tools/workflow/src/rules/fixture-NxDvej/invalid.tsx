import {Array, Context, Effect, Option as Maybe, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'
import * as React from 'react'

import {useRef, useState} from 'react'

declare const input: unknown
declare const source: string
declare const values: string[]
const mappedValues = values.map(value => value.length)
const deepPipe = pipe(values, Array.appendAll(pipe(values, Array.appendAll(pipe(values, Array.appendAll(pipe(values, Array.take(1))))))))
const decode =Schema.decodeUnknownSync(Schema.String)
const operations = {decode: Schema.decodeUnknownSync(Schema.String)}
class Codecs { decode = Schema.decodeUnknownSync(Schema.String) }
const decoders = [Schema.decodeUnknownSync(Schema.String)]
const IsString = Schema.is(Schema.String)
const AssertString = Schema.asserts(Schema.String)
let assigned = decode
assigned = Schema.decodeUnknownSync(Schema.String)
const MissingType = Schema.Struct({value: Schema.String})
type NonEmpty = typeof NonEmpty.Type
const NonEmpty = Schema.String.check(Schema.isMinLength(1))
type PipedNonEmpty = typeof PipedNonEmpty.Type
const PipedNonEmpty = pipe(Schema.String, Schema.check(Schema.isNonEmpty()))
type PipedTrimmed = typeof PipedTrimmed.Type
const PipedTrimmed = Schema.String.pipe(Schema.check(Schema.isTrimmed()))
const MissingFluent = Schema.String.annotate({description: "value"})
const MissingTransform = Schema.decodeTo(Schema.Number, SchemaTransformation.transform({decode: Number, encode: String}))(Schema.String)
const MissingDecode = Schema.decode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)
const MissingEncode = Schema.encode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)
type Tree = typeof Tree.Type
const Tree: Schema.Codec<Tree> = Schema.Struct({children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree))})
type Explicit = {readonly values: readonly string[]}
type Mapped<T> = {readonly [K in keyof T]: T[K]}
type Frozen = Readonly<{value: string}>
type Index = {readonly [key: string]: string}
class Input { readonly field = "value"; constructor(readonly value: string) {} }
class Clock extends Context.Service<Clock, {now: Effect.Effect<number>; tick(): Effect.Effect<void>}>()("Clock") {}
const ref = useRef<HTMLElement | null>(null)
const namespaceRef = React.useRef<HTMLElement | null>(null)
const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(source)
const directDecoded = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(source)
function forward(value: string) { return consume(value) }
function ready() { return source.length > 0 }
const noValues = values.length === 0
function run() { consume(source) }
function consume(value: string) { return value.length }
function sourceLength(value: {text: string}) { return consume(value.text) }
const measured = sourceLength({text: source})
const callbacks = {consume: (value: string) => consume(value)}
const alias = source
function Fallback() { return <div className="missing" /> }
const fallbacks = Array.map([input], Fallback)
const notFound = () => Array.empty<string>()
const emptyNames = () => "none"
declare const maybe: Maybe.Option<string>
const unwrapped = Maybe.isSome(maybe) ? maybe.value : ""
declare const loosely: string | null | undefined
const present = loosely !== null && loosely !== undefined
const absent = Array.isArrayEmpty(values) || loosely === null || loosely === undefined
declare const holder: {slot: Maybe.Option<string>}
function slotLength() { if (Maybe.isNone(holder.slot)) return 0; return holder.slot.value.length }
function kind(value: number) { switch (value) { case 1: return "one"; default: return "many" } }
const namesA = emptyNames()
const namesB = emptyNames()
const asyncConstant = async () => "ready"
const recipients = Array.isArray(input) ? input : [input]
const wrapped = !Array.isArray(input) ? [input] : input
const [fake] = useState(() => ({current: null}))
const state = useState(0)
const [fakeNamespace] = React.useState(() => ({current: null}))
const stateNamespace = React.useState(0)
function isText(value: unknown): value is string { return typeof value === "string" }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const label = "ready"
const labelled = consume(label)
declare function download(id: string): Promise<string>
const handlers = {load: (id: string) => Effect.tryPromise(() => download(id)), size: (id: string) => pipe(id, Effect.succeed)}
function greet(name: string): string { return `hi ${name}` }
function logName(name: string): void { consume(name) }
declare class Box { constructor(size: number) }
const makeBox = (size: number): Box => new Box(size)
export const makeBytes = (): Uint8Array => new Uint8Array(4)
const empties: string[] = []
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const failing = Effect.gen(function* () { yield* Effect.void; return yield* Effect.fail(new Missing()) })
const failingFn = Effect.fn("failing")(function* (id: string) { yield* Effect.logInfo(id); return yield* Effect.fail(Missing.make({})) })
// oxlint-disable-next-line eqeqeq
const loose = source == "ready"
// oxlint-disable-next-line sort-keys -- the fixture keeps its order
const unsortedKeys = {b: 1, a: 2}
// @effect-diagnostics-next-line floatingEffect:off
export {AssertString, Clock, Codecs, NonEmpty, PipedNonEmpty, PipedTrimmed, absent, Fallback, Input, IsString, Maybe, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, Tree, alias, assigned, asyncConstant, callbacks, decode, decoded, decoders, deepPipe, directDecoded, empties, failing, failingFn, fake, fakeNamespace, fallbacks, forward, greet, handlers, input, isRecord, isText, makeBox, labelled, logName, loose, kind, mappedValues, measured, namesA, namesB, namespaceRef, noValues, present, slotLength, notFound, operations, ready, recipients, ref, run, stateNamespace, unsortedKeys, unwrapped, wrapped}
export type {Explicit, Frozen, Index, Mapped}