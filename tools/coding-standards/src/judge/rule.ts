import {Array, Number, Option, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {STALE_BELOW, THRESHOLD, questionKey, readVerdicts, unitKey} from '#judge/cache.ts'
import type {UnitKind} from '#judge/units.ts'
import {importsOf, units} from '#judge/units.ts'
import {matches} from '#rules/shared.ts'

// One yes-or-no question asked of one unit at a time: yes is the violation, and `criteria` draws the line between yes and no. The example pair is the question's own check, run with `judge --examples`.
export type Question = {
	criteria: {false: string; true: string}
	examples: {bad: string; good: string}
	kind: UnitKind
	message: string
	question: string
}

// Each file's units and cached verdicts, read once for every judged rule.
const judgedFiles = new WeakMap<ESTree.Program, ReturnType<typeof judgedUnits>>()

function judgedUnits(input: {
	filename: string
	program: ESTree.Program
	source: string
	visitorKeys: Readonly<Record<string, readonly string[]>>
}) {
	const imports = importsOf(input.program, input.source)
	return Array.map(units(input), unit => ({unit, verdicts: readVerdicts(unitKey(unit, imports))}))
}

// A judged rule reports the verdict `judge` cached before lint ran, since Oxlint runs rules synchronously; with no verdict, as in CI, it stays quiet.
export function judgedRule(question: Question) {
	const key = questionKey(question)
	const rule = defineRule({
		create: context => ({
			Program: program => {
				const name = String.replace(/^.*\//u, '')(context.id)
				const lines = String.split('\n')(context.sourceCode.text)
				const found =
					judgedFiles.get(program) ??
					judgedUnits({
						filename: context.filename,
						program,
						source: context.sourceCode.text,
						visitorKeys: context.sourceCode.visitorKeys
					})
				judgedFiles.set(program, found)
				for (const entry of Array.filter(found, candidate => candidate.unit.kind === question.kind)) {
					const score = Option.getOrUndefined(Option.flatMap(entry.verdicts, Record.get(key)))
					// The ignore sits in the comment lines right above the unit, beside any comment explaining the unit.
					const ignored = pipe(
						Array.take(lines, entry.unit.line - 1),
						Array.reverse,
						Array.takeWhile(matches(/^\s*\/\//u)),
						Array.some(matches(new RegExp(`judge-ignore ${name} -- \\S`, 'u')))
					)
					const loc = {
						end: {
							column: pipe(
								Array.get(lines, entry.unit.line - 1),
								Option.map(String.length),
								Option.getOrElse(() => 0)
							),
							line: entry.unit.line
						},
						start: {column: 0, line: entry.unit.line}
					}
					if (score !== undefined && score >= THRESHOLD && !ignored) {
						context.report({
							loc,
							message: `${question.message} Judged ${Number.round(score, 2)}; if the judgement is wrong, put \`// judge-ignore ${name} -- <reason>\` in the comment above.`
						})
					}
					if (score !== undefined && score < STALE_BELOW && ignored) {
						context.report({loc, message: `This now passes ${name}; remove its judge-ignore comment.`})
					}
				}
			}
		}),
		meta: {docs: {description: question.question}, type: 'suggestion'}
	})
	return {...rule, question}
}
