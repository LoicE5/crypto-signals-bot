import logUpdate from 'log-update'

const WRITE_LIMIT = Number(process.env.WRITE_SCROLL_LIMIT) || 5
const SIMULATE_LIMIT = Number(process.env.SIMULATE_SCROLL_LIMIT) || 15

function createScrollLogger(limit: number) {
    const buffer: string[] = []
    return function log(value: unknown): void {
        const line = typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value)
        buffer.push(line)
        if(buffer.length > limit)
            buffer.shift()
        logUpdate(buffer.join('\n'))
    }
}

export const writeLogger = createScrollLogger(WRITE_LIMIT)
export const simulateLogger = createScrollLogger(SIMULATE_LIMIT)
