import {Array, Record, String, pipe} from 'effect'

import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'vite-plus'

import {serverPack} from '@deslop/runtime/config/vite'

import {ProfileScreen} from '#screens/portfolio.ts'

const description = `${ProfileScreen.profile.title}. ${ProfileScreen.summary}`

function escaped(text: string) {
	return pipe(
		text,
		String.replaceAll('&', '&amp;'),
		String.replaceAll('<', '&lt;'),
		String.replaceAll('>', '&gt;'),
		String.replaceAll('"', '&quot;')
	)
}

function link(target: {href: string; value: string}) {
	return `<a href="${escaped(target.href)}">${escaped(target.value)}</a>`
}

// Link previews and readers that run no script read the HTML alone: it names the person on both routes and carries the profile as plain text, which the app replaces once it runs.
export default defineConfig({
	build: {
		chunkSizeWarningLimit: 750,
		modulePreload: {polyfill: false},
		outDir: 'dist/client',
		rolldownOptions: {output: {codeSplitting: {groups: [{name: 'effect', test: /node_modules[\\/]effect[\\/]/u}]}}},
		target: 'esnext'
	},
	pack: serverPack(512),
	plugins: [
		tailwindcss({optimize: true}),
		{
			name: 'portfolio-document',
			transformIndexHtml: () => [
				{children: escaped(`${ProfileScreen.name} – ${ProfileScreen.profile.title}`), injectTo: 'head', tag: 'title'},
				{attrs: {content: ProfileScreen.name, name: 'author'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: description, name: 'description'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: 'profile', property: 'og:type'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: ProfileScreen.name, property: 'og:title'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: description, property: 'og:description'}, injectTo: 'head', tag: 'meta'},
				{
					attrs: {content: `https://${ProfileScreen.profile.portfolio}/`, property: 'og:url'},
					injectTo: 'head',
					tag: 'meta'
				},
				{
					children: Array.join(
						[
							`<h1>${escaped(ProfileScreen.name)}</h1>`,
							`<p>${escaped(description)}</p>`,
							`<p>${escaped(ProfileScreen.profile.location)}</p>`,
							'<h2>Experience</h2><ul>',
							...Array.map(
								ProfileScreen.experience,
								job => `<li>${escaped(`${job.role}, ${job.company} (${job.period})`)}</li>`
							),
							'</ul><h2>Projects</h2><ul>',
							...Array.map(
								ProfileScreen.projects,
								project =>
									`<li>${link({href: project.href, value: project.name})}: ${escaped(project.description)}</li>`
							),
							'</ul><h2>Contact</h2><ul>',
							...Array.map(
								Record.values(ProfileScreen.contacts),
								contact => `<li>${escaped(contact.label)}: ${link(contact)}</li>`
							),
							`<li>${link({href: ProfileScreen.cvPath, value: 'CV'})}</li></ul>`,
							// Italian law asks a VAT holder's website to show the number on its home page.
							`<p>VAT ${escaped(ProfileScreen.profile.vat)}</p>`
						],
						''
					),
					injectTo: 'body-prepend',
					tag: 'noscript'
				}
			]
		}
	]
})
