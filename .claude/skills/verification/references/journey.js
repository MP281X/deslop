// Pass this file's text plus `play([...steps])` to preview_evaluate while the tab records; the verification skill lists the steps.
async function play(steps) {
	document.querySelector('#journey')?.remove()
	const layer = document.createElement('div')
	layer.id = 'journey'
	layer.style.cssText =
		'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:500 15px/1.4 system-ui,sans-serif'
	layer.innerHTML = `<svg width="20" height="29" viewBox="0 0 13 19" style="position:absolute;left:0;top:0;translate:50vw 92vh;transition:translate .5s cubic-bezier(.4,0,.2,1)"><path d="M1 1v14.2l3.7-3.5 2.5 5.9 2.3-1-2.5-5.8H12z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>
		<i style="position:absolute;left:-20px;top:-20px;width:40px;height:40px;border-radius:50%;border:2px solid #3b82f6;opacity:0"></i>
		<div style="position:absolute;left:50%;bottom:28px;translate:-50% 0;padding:6px 16px;border-radius:999px;background:#111;color:#fff;outline:1px solid #fff4;white-space:nowrap"></div>`
	document.body.append(layer)
	const [cursor, ripple, caption] = layer.children

	function sleep(ms) {
		return new Promise(resolve => {
			setTimeout(resolve, ms)
		})
	}
	function shown(element) {
		const rect = element.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
	}
	function nameOf(element) {
		const names = [
			element.getAttribute('aria-label'),
			element.getAttribute('placeholder'),
			element.labels?.[0]?.textContent,
			element.textContent
		]
		return names.map(text => (text || '').trim().replaceAll(/\s+/gu, ' ')).find(Boolean) || ''
	}
	function query(name, pool) {
		if (/^[#.[]/u.test(name)) return [...document.querySelectorAll(name)].find(shown)
		const hits = [...document.querySelectorAll(pool)].filter(
			element => !layer.contains(element) && nameOf(element) === name && shown(element)
		)
		// The innermost element carrying the name, so a row's button wins over the row.
		return hits.find(element => !hits.some(other => other !== element && element.contains(other)))
	}
	// Targets may still be loading, so each one gets eight seconds to appear.
	/** @param {number} waited */
	async function find(name, pool, waited) {
		const element = query(name, pool)
		if (element) return element
		if (waited >= 8000) throw new Error(`no visible target named "${name}"`)
		await sleep(200)
		return find(name, pool, waited + 200)
	}
	/** @param {Element} element */
	async function aim(element) {
		element.scrollIntoView({block: 'nearest', inline: 'nearest'})
		const rect = element.getBoundingClientRect()
		const point = {x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height * 0.6}
		cursor.style.translate = `${point.x}px ${point.y}px`
		ripple.style.translate = cursor.style.translate
		await sleep(550)
		ripple.animate(
			[
				{opacity: 1, scale: 0.2},
				{opacity: 0, scale: 1}
			],
			{duration: 450, easing: 'ease-out'}
		)
		return point
	}
	async function click(element) {
		const point = await aim(element)
		const init = {
			bubbles: true,
			button: 0,
			cancelable: true,
			clientX: point.x,
			clientY: point.y,
			composed: true,
			isPrimary: true,
			pointerType: 'mouse'
		}
		element.dispatchEvent(new PointerEvent('pointerdown', init))
		element.dispatchEvent(new MouseEvent('mousedown', init))
		element.dispatchEvent(new PointerEvent('pointerup', init))
		element.dispatchEvent(new MouseEvent('mouseup', init))
		element.focus?.()
		element.click()
	}
	// React tracks a field's value through the prototype's setter, so typing goes through it.
	/** @param {number} end */
	async function typeFrom(element, text, end) {
		if (end > text.length) {
			element.dispatchEvent(new Event('change', {bubbles: true}))
			return
		}
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, text.slice(0, end))
		element.dispatchEvent(new InputEvent('input', {bubbles: true, data: text[end - 1], inputType: 'insertText'}))
		await sleep(70)
		await typeFrom(element, text, end + 1)
	}
	function press(key) {
		const target = document.activeElement || document.body
		target.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key}))
		target.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true, key}))
		if (key === 'Enter') target.form?.requestSubmit()
	}
	function labelOf(step) {
		if (step.label) return step.label
		if (step.type !== undefined) return `Type “${step.type}”`
		if (step.see !== undefined) return `See “${step.see}”`
		return step.say ?? step.press ?? step.click
	}
	async function act(step) {
		const targets = 'a,button,input,label,summary,select,textarea,[role],[tabindex],td,li,span,div,p'
		if (step.click !== undefined) await click(await find(step.click, targets, 0))
		if (step.type !== undefined) {
			const field = await find(step.into, 'input,textarea', 0)
			await click(field)
			await typeFrom(field, step.type, 1)
		}
		if (step.press !== undefined) press(step.press)
		if (step.see !== undefined) await find(step.see, targets, 0)
	}
	/** @param {number} index */
	async function run(index, outcomes) {
		if (index === steps.length) return outcomes
		const step = Object.assign(
			{},
			typeof steps[index] === 'string' && {click: steps[index]},
			typeof steps[index] === 'object' && steps[index]
		)
		const label = labelOf(step)
		caption.textContent = `${index + 1}/${steps.length}  ${label}`
		try {
			await act(step)
		} catch (error) {
			return [...outcomes, `${index + 1} ${label}: ${error.message}`]
		}
		await sleep(900)
		return run(index + 1, [...outcomes, `${index + 1} ${label}: ok`])
	}

	// The recording starts in the same turn, so the first step waits for it; the last caption stays until it stops.
	await sleep(400)
	const from = Date.now()
	const outcomes = await run(0, [])
	await sleep(1200)
	setTimeout(() => layer.remove(), 5000)
	return {from, outcomes}
}
