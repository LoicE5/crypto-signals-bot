import { describe, expect, test, beforeEach, afterAll } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { appendLine, readNdjson, writeFile as writeNdjson } from '../../src/lib/ndjson'

const tempDir = './test/_tmp_ndjson'

beforeEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    await mkdir(tempDir, { recursive: true })
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe('appendLine + readNdjson', () => {
    test('round-trips three records', async () => {
        const path = `${tempDir}/roundtrip.ndjson`
        await writeNdjson(path, '')
        await appendLine(path, JSON.stringify({ a: 1 }))
        await appendLine(path, JSON.stringify({ a: 2 }))
        await appendLine(path, JSON.stringify({ a: 3 }))
        const rows = await readNdjson<{ a: number }>(path)
        expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
    })

    test('skips blank lines', async () => {
        const path = `${tempDir}/blanks.ndjson`
        await writeFile(path, '{"a":1}\n\n{"a":2}\n   \n{"a":3}\n')
        const rows = await readNdjson<{ a: number }>(path)
        expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
    })

    test('skips malformed line without throwing', async () => {
        const path = `${tempDir}/malformed.ndjson`
        await writeFile(path, '{"a":1}\n{not json\n{"a":2}\n')
        const rows = await readNdjson<{ a: number }>(path)
        expect(rows).toEqual([{ a: 1 }, { a: 2 }])
    })

    test('appendLine adds trailing newline exactly once', async () => {
        const path = `${tempDir}/newline.ndjson`
        await writeNdjson(path, '')
        await appendLine(path, '{"a":1}')
        await appendLine(path, '{"a":2}\n')
        const text = await Bun.file(path).text()
        expect(text).toBe('{"a":1}\n{"a":2}\n')
    })
})
