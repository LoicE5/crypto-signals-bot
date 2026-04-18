import { appendFile as nodeAppendFile } from "node:fs"

export async function writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content)
}

export function appendLine(path: string, line: string): Promise<void> {
    return new Promise((resolve, reject) => {
        nodeAppendFile(path, line.endsWith('\n') ? line : `${line}\n`, (error: NodeJS.ErrnoException | null) => {
            if(error)
                return reject(error)
            resolve()
        })
    })
}

export async function readNdjson<T = unknown>(path: string): Promise<T[]> {
    const text = await Bun.file(path).text()
    const rows: T[] = []
    for(const raw of text.split('\n')) {
        const line = raw.trim()
        if(line.length === 0)
            continue
        try {
            rows.push(JSON.parse(line) as T)
        } catch(parseError: unknown) {
            console.warn(`Skipping malformed NDJSON line: ${parseError}`)
        }
    }
    return rows
}
