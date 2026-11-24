// node compare.js <cut.json>: cuts a Before and an After recording into one side-by-side video; see SKILL.md.
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

/** @typedef {{end: number, key: string, label: string, parts: number[][], press?: number, rect?: number[], start: number}} Mark */
/** @typedef {{result: {marks: Mark[], outcomes: string[], viewport: number[]}, startedAt: string, video: string}} Recording */
/** @typedef {{after: Recording, before?: Recording, out: string}} Cut */
/** @typedef {{name: string, scale: number, steps: Mark[], video: string, viewport: number[]}} Side */
/** @typedef {{a?: number, b?: number, duration: number, from: number}} Column */

const FPS = 30
const PAD = 16
const MIN = [360, 200]
const HOLD = 1.5
// The prototype's look, at three device pixels per CSS pixel, in its dark theme's colours.
const K = 3
const BACKGROUND = '0x0a0a0a'
const FOREGROUND = '0xf5f5f5'
const MUTED = '0x818181'
const ADD = '0x10b981'
const GAP = 8 * K
const FONT = 13 * K
const ROW = 22 * K
const BAR = ROW + 4 * K
const CHIP = {border: K, height: 20 * K, pad: 5 * K, radius: 5 * K}
const FRAME = {border: K, radius: 10 * K}

/** @type {Cut} */
const cut = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const dir = mkdtempSync(join(tmpdir(), 'compare-'))

/** @param {string} name @param {Recording} recording @returns {Side} */
function load(name, recording) {
	const failed = recording.result.outcomes.find(outcome => outcome.includes(': failed,'))
	if (failed) throw new Error(`${name}: ${failed}`)
	const width = Number(
		execFileSync(
			'ffprobe',
			['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', recording.video],
			{encoding: 'utf8'}
		).trim()
	)
	const zero = Date.parse(recording.startedAt)
	/** @param {number} epoch */
	function at(epoch) {
		return (epoch - zero) / 1000
	}
	const steps = recording.result.marks.map(mark => ({
		...mark,
		end: at(mark.end),
		press: mark.press && at(mark.press),
		start: at(mark.start)
	}))
	return {
		name,
		scale: width / recording.result.viewport[0],
		steps,
		video: recording.video,
		viewport: recording.result.viewport
	}
}

// Steps of b lined up against a's: equal steps are cut, a replaced step shares a column.
/** @param {number | undefined} b @param {number | undefined} a @returns {[number | undefined, number | undefined]} */
function slot(b, a) {
	return [b, a]
}
/** @param {string[]} a @param {string[]} b @returns {[number | undefined, number | undefined][]} */
function columns(a, b) {
	const table = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0))
	/** @param {number} i @param {number} j @returns {number} */
	function common(i, j) {
		return table[i][j]
	}
	/** @param {number} i @param {number} j @returns {number} */
	function score(i, j) {
		if (a[i] === b[j]) return common(i + 1, j + 1) + 1
		return Math.max(common(i + 1, j), common(i, j + 1))
	}
	a.map((_, n) => a.length - 1 - n).forEach(i => {
		b.map((_, n) => b.length - 1 - n).forEach(j => {
			table[i][j] = score(i, j)
		})
	})
	/** @param {number} i @param {number} j @param {number[]} dels @returns {[number, number[]]} */
	function dropped(i, j, dels) {
		if (i >= a.length || (j < b.length && (a[i] === b[j] || common(i + 1, j) < common(i, j + 1)))) return [i, dels]
		return dropped(i + 1, j, [...dels, i])
	}
	/** @param {number} i @param {number} j @param {number[]} adds @returns {[number, number[]]} */
	function added(i, j, adds) {
		if (j >= b.length || (i < a.length && (a[i] === b[j] || common(i, j + 1) < common(i + 1, j)))) return [j, adds]
		return added(i, j + 1, [...adds, j])
	}
	/** @param {number} i @param {number} j @returns {[number | undefined, number | undefined][]} */
	function walk(i, j) {
		if (i >= a.length && j >= b.length) return []
		if (i < a.length && j < b.length && a[i] === b[j]) return walk(i + 1, j + 1)
		const [nextI, dels] = dropped(i, j, [])
		const [nextJ, adds] = added(nextI, j, [])
		// A step that ties both ways is taken from a, so the walk always moves.
		if (dels.length + adds.length === 0) return [[i, undefined], ...walk(i + 1, j)]
		return [
			...Array.from({length: Math.max(dels.length, adds.length)}, (_, n) => slot(dels[n], adds[n])),
			...walk(nextI, nextJ)
		]
	}
	return walk(0, 0)
}

/** @param {Side | undefined} side @param {number | undefined} step */
function labelOf(side, step) {
	if (!side || step === undefined) return ''
	return side.steps[step].label
}

/** @param {Side | undefined} side @param {number | undefined} step */
function length(side, step) {
	if (!side || step === undefined) return 0
	return side.steps[step].end - side.steps[step].start
}

const after = load('after', cut.after)
const before = cut.before && load('before', cut.before)
const sides = [before, after].filter(side => side !== undefined)
/** @returns {[number | undefined, number | undefined][]} */
function align() {
	if (!before) return after.steps.map((_, j) => slot(undefined, j))
	return columns(
		before.steps.map(step => step.key),
		after.steps.map(step => step.key)
	)
}
const pairs = align()
if (pairs.length === 0) throw new Error('Before and After take the same steps: nothing to compare')
/** @param {Column[]} cols @param {[number | undefined, number | undefined]} pair @returns {Column[]} */
function append(cols, pair) {
	return [
		...cols,
		{
			a: pair[1],
			b: pair[0],
			duration: Math.max(length(before, pair[0]), length(after, pair[1])),
			from: cols.reduce((sum, col) => sum + col.duration, 0)
		}
	]
}
const timeline = pairs.reduce(append, [])
const clock = timeline.reduce((sum, col) => sum + col.duration, 0)
const total = clock + HOLD

/** @param {Side} side */
function own(side) {
	if (side === before) return timeline.map(col => col.b)
	return timeline.map(col => col.a)
}
/** @param {Side} side */
function kept(side) {
	return own(side).filter(step => step !== undefined)
}
// The part of the page a side's kept steps use, in CSS pixels, padded.
/** @param {Side} side */
function region(side) {
	const parts = kept(side).flatMap(step => side.steps[step].parts)
	if (parts.length === 0) return {b: side.viewport[1], r: side.viewport[0], x: 0, y: 0}
	return {
		b: Math.max(...parts.map(part => part[3])) + PAD,
		r: Math.max(...parts.map(part => part[2])) + PAD,
		x: Math.min(...parts.map(part => part[0])) - PAD,
		y: Math.min(...parts.map(part => part[1])) - PAD
	}
}
// A span grown to `want` around its centre, kept within the page.
/** @param {number} lo @param {number} hi @param {number} want @param {number} max */
function grow(lo, hi, want, max) {
	const size = Math.min(max, Math.max(hi - lo, want))
	return [Math.max(0, Math.min(max - size, (lo + hi) / 2 - size / 2)), size]
}
/** @param {number} n */
function even(n) {
	return Math.round(n / 2) * 2
}

// Panes of one size, each showing its region at the largest scale that fits.
const pane = even((640 * K - GAP * (sides.length - 1)) / sides.length)
const frames = sides.map(side => {
	const r = region(side)
	const z = Math.min(side.scale, pane / grow(r.x, r.r, MIN[0], side.viewport[0])[1])
	return {r, side, tall: Math.min(side.viewport[1], Math.max(MIN[1], r.b - r.y)) * z, z}
})
const height = even(Math.min(2160, Math.max(...frames.map(frame => frame.tall))))

/** @param {string} name @param {string} value */
function text(name, value) {
	const file = join(dir, `${name}.txt`)
	writeFileSync(file, value)
	return file
}
/** @param {string} [when] */
function enabled(when) {
	if (when) return `:enable='${when}'`
	return ''
}
/** @param {string} file @param {string} colour @param {number} x @param {string} [when] */
function words(file, colour, x, when) {
	return `drawtext=font=sans:fontsize=${FONT}:fontcolor=${colour}:x=${x}:y=${Math.round(ROW / 2 + FONT * 0.35)}:y_align=baseline:textfile=${file}${enabled(when)}`
}
/** @param {string} hex @param {number} shift */
function channel(hex, shift) {
	return (Number(hex) >> shift) & 255
}
// A rounded outline as an image to lay over the video, since ffmpeg draws only square boxes; `fill` paints outside it.
/** @param {string} name @param {number} w @param {number} h @param {number} radius @param {number} thickness @param {string} line @param {string} [fill] */
function outline(name, w, h, radius, thickness, line, fill) {
	const file = join(dir, `${name}.png`)
	const shape = `st(0,max(max(${radius}-X,X-(W-1-${radius})),0));st(1,max(max(${radius}-Y,Y-(H-1-${radius})),0));st(2,hypot(ld(0),ld(1)));st(3,clip(${radius}+0.5-ld(2),0,1)*clip(ld(2)-${radius - thickness}+0.5,0,1));st(4,${Number(Boolean(fill))}*clip(ld(2)-${radius}+0.5,0,1))`
	/** @param {number} shift */
	function colour(shift) {
		return `'${shape};if(gte(ld(3),ld(4)),${channel(line, shift)},${channel(fill ?? line, shift)})'`
	}
	execFileSync('ffmpeg', [
		'-v',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		`color=c=black:s=${w}x${h}`,
		'-vf',
		`format=rgba,geq=r=${colour(16)}:g=${colour(8)}:b=${colour(0)}:a='${shape};255*max(ld(3),ld(4))'`,
		'-frames:v',
		'1',
		file
	])
	return file
}
/** @template T @param {Side} side @param {T} onAfter @param {T} onBefore @returns {T} */
function pick(side, onAfter, onBefore) {
	if (side === after) return onAfter
	return onBefore
}
/** @param {boolean} dim */
function shade(dim) {
	if (dim) {
		return `,format=rgb24,lutrgb=r=val/2+${channel(BACKGROUND, 16) / 2}:g=val/2+${channel(BACKGROUND, 8) / 2}:b=val/2+${channel(BACKGROUND, 0) / 2}`
	}
	return ''
}

const lines = frames.flatMap((frame, s) => {
	const side = frame.side
	const steps = own(side)
	const last = side.steps[kept(side).at(-1) ?? 0].end - 1 / FPS
	// A recording has frames only while the page changes, so it is made constant-rate and its last frame held.
	const source = `[${s}:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=${total},`
	/** @param {number} time @param {number} duration @param {string} name @param {boolean} dim */
	function hold(time, duration, name, dim) {
		return `${source}trim=start=${time},setpts=PTS-STARTPTS,trim=end_frame=1,loop=loop=${Math.round(duration * FPS) - 1}:size=1:start=0,setpts=N/(${FPS}*TB)${shade(dim)}[${name}]`
	}
	// A side that waits shows the state before its next kept step, or after its last one, dimmed.
	/** @param {number} n */
	function still(n) {
		const next = steps.slice(n).find(step => step !== undefined)
		if (next === undefined) return last
		return side.steps[next].start
	}
	const segments = timeline.map((col, n) => {
		const step = steps[n]
		if (step === undefined) return hold(still(n), col.duration, `s${s}p${n}`, true)
		const mark = side.steps[step]
		return `${source}trim=start=${mark.start}:end=${mark.end},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${col.duration},trim=duration=${col.duration}[s${s}p${n}]`
	})
	const colour = pick(side, ADD, '0x346bf1')
	// The tap's ring, as the prototype draws it, for a moment from the press: green on After, whose kept steps are all new.
	const rings = timeline.flatMap((col, n) => {
		const step = steps[n]
		if (step === undefined) return []
		const mark = side.steps[step]
		if (!mark.rect || mark.press === undefined) return []
		const gap = 3 * side.scale
		const [x, y, right, bottom] = mark.rect.map(v => Math.round(v * side.scale))
		const on = col.from + Math.max(0, mark.press - mark.start)
		const file = outline(
			`r${s}_${n}`,
			right - x + 2 * gap,
			bottom - y + 2 * gap,
			4 * side.scale,
			2 * side.scale,
			colour
		)
		return [{file, when: `between(t,${on},${Math.min(col.from + col.duration, on + 0.7)})`, x: x - gap, y: y - gap}]
	})
	const ringed = rings.map(
		(ring, n) =>
			`movie=${ring.file}[k${s}_${n}];[c${s}_${n}][k${s}_${n}]overlay=x=${ring.x}:y=${ring.y}:enable='${ring.when}'[c${s}_${n + 1}]`
	)
	const [x, w] = grow(frame.r.x, frame.r.r, pane / frame.z, side.viewport[0])
	const [y, h] = grow(frame.r.y, frame.r.b, height / frame.z, side.viewport[1])
	const name = pick(side, 'After', 'Before')
	// The prototype's tile: its name in a bordered chip, the step beside it, the screen in a rounded frame below.
	const chip = Math.round(name.length * FONT * 0.6 + 2 * (CHIP.pad + CHIP.border))
	const captions = timeline.map((col, n) => {
		const step = steps[n]
		const when = `between(t,${col.from},${col.from + col.duration})`
		if (step === undefined) return words(text(`c${s}_${n}`, 'waits'), MUTED, chip + 6 * K, when)
		return words(text(`c${s}_${n}`, side.steps[step].label), pick(side, ADD, FOREGROUND), chip + 6 * K, when)
	})
	const border = outline(`f${s}`, pane, height, FRAME.radius, FRAME.border, '0x191919', BACKGROUND)
	const badge = outline(`b${s}`, chip, CHIP.height, CHIP.radius, CHIP.border, '0x1e1e1e')
	const names = [...segments.map((_, n) => `[s${s}p${n}]`), `[s${s}end]`].join('')
	return [
		...segments,
		hold(last, HOLD, `s${s}end`, false),
		`${names}concat=n=${segments.length + 1}:v=1:a=0[c${s}_0]`,
		...ringed,
		`movie=${border}[f${s}]`,
		`movie=${badge}[b${s}]`,
		`[c${s}_${rings.length}]crop=${even(w * side.scale)}:${even(h * side.scale)}:${even(x * side.scale)}:${even(y * side.scale)},scale=${even(w * frame.z)}:${even(h * frame.z)}:flags=lanczos,pad=${pane}:${height}:(ow-iw)/2:0:${BACKGROUND}[p${s}]`,
		`[p${s}][f${s}]overlay[q${s}]`,
		`[q${s}]pad=iw:ih+${BAR}:0:${BAR}:${BACKGROUND}[h${s}]`,
		[
			`[h${s}][b${s}]overlay=x=0:y=${(ROW - CHIP.height) / 2}`,
			`drawtext=font=monospace:fontsize=${FONT}:fontcolor=${FOREGROUND}:x=${CHIP.pad + CHIP.border}:y=${Math.round(ROW / 2 + FONT * 0.35)}:y_align=baseline:textfile=${text(`t${s}`, name)}`,
			...captions,
			`${words(text(`c${s}_end`, 'Done'), MUTED, chip + 6 * K, `gte(t,${clock})`)}[v${s}]`
		].join(',')
	]
})
/** @returns {string} */
function joined() {
	if (sides.length === 1) return '[v0]format=yuv420p[out]'
	return `[v0]pad=iw+${GAP}:ih:0:0:${BACKGROUND}[l];[l][v1]hstack=inputs=2,format=yuv420p[out]`
}
const script = join(dir, 'filter.txt')
writeFileSync(script, [...lines, joined()].join(';\n'))
execFileSync(
	'ffmpeg',
	[
		'-v',
		'error',
		'-y',
		...sides.flatMap(side => ['-i', side.video]),
		'-filter_complex_script',
		script,
		'-map',
		'[out]',
		'-t',
		String(total),
		'-c:v',
		'libx264',
		'-pix_fmt',
		'yuv420p',
		'-color_range',
		'tv',
		'-movflags',
		'+faststart',
		'-an',
		cut.out
	],
	{stdio: 'inherit'}
)
console.log(
	JSON.stringify({
		columns: timeline.map(col => [labelOf(before, col.b), labelOf(after, col.a)]),
		out: cut.out,
		seconds: total
	})
)
