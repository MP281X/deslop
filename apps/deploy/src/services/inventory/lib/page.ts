import {String} from 'effect'

// A remote source prefixes its worker and a local one names its own collector, so a bare worker name is that worker's.
export function sourceBelongsToWorker(source: {readonly name: string}, worker: string) {
	return source.name === worker || String.startsWith(`${worker} · `)(source.name)
}
