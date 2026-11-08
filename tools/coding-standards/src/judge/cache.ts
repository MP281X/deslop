// oxlint-disable-next-line effecttsgo/node-builtin-import -- Oxlint runs rules synchronously, so they hash units and read verdicts without an Effect runtime.
import {createHash} from 'node:crypto'
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Oxlint runs rules synchronously, so they hash units and read verdicts without an Effect runtime.
import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Oxlint runs rules synchronously, so they hash units and read verdicts without an Effect runtime.
import {join} from 'node:path'

import {Array, Option, Schema} from 'effect'

import type {Unit} from '#judge/units.ts'

// At or above this probability a judged rule reports: above TypeSafe's suggested 0.7, since a false yes blocks the gate and every rerun of Jev moves a score near 0.7 across it.
export const THRESHOLD = 0.8
// A judge-ignore goes stale only once Jev clearly answers no: a unit asked again scores within about 0.06, so one near the threshold would otherwise flip between a report and a stale ignore.
export const STALE_BELOW = 0.5

// Shared by every checkout of this user, so a unit judged in one worktree is never asked again in another.
// oxlint-disable-next-line effecttsgo/process-env -- Oxlint loads rules with no Effect runtime to read Config from; tests point it at a scratch directory.
export const CACHE_DIRECTORY = process.env['DESLOP_JUDGE_CACHE'] ?? join(homedir(), '.cache', 'deslop-judge')

// The probability that the unit breaks each question, by the question's key.
export type Verdicts = typeof Verdicts.Type
export const Verdicts = Schema.Record(Schema.String, Schema.Finite)

function hash(parts: string[]) {
	return createHash('sha256').update(Array.join(parts, '\u0000')).digest('base64url')
}

// A unit's verdicts file changes with its text and its file's imports, so editing either asks again.
export function unitKey(unit: Unit, imports: string) {
	return hash([unit.kind, imports, unit.text])
}

// A question's answers change with its wording, so rewording one asks only it again.
export function questionKey(asked: {criteria: {false: string; true: string}; question: string}) {
	return hash([asked.question, asked.criteria.true, asked.criteria.false])
}

export function readVerdicts(key: string) {
	return Option.flatMap(
		Option.liftThrowable(() => readFileSync(join(CACHE_DIRECTORY, `${key}.json`), 'utf8'))(),
		Schema.decodeOption(Schema.fromJsonString(Verdicts))
	)
}
