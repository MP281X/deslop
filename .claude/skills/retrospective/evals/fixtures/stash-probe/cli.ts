import {exportNotes} from './export.ts'

const folder = process.argv[2] ?? '.'
console.log(`Exported ${exportNotes(folder)} notes to ${folder}`)
