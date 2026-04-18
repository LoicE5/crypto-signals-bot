import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { calculateSignalProfit, analyseNdjson } from '../../src/analysis/roi'
import { TickerRow } from '../../src/types'

const tempDir = './test/_tmp_roi'

beforeAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
    await mkdir(tempDir, { recursive: true })
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

async function writeRows(path: string, rows: TickerRow[]): Promise<void> {
    await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
}

// A BUY run from entry to exit: the last BUY row is at `exitPrice`, followed by
// a single NEUTRAL row. analyseNdjson uses the final BUY row's price as the exit.
function buyRun(entryPrice: number, exitPrice: number): TickerRow[] {
    return [
        { pair: 'X', interval: '1m', unix_time: 1, price: entryPrice, signal: 'BUY' },
        { pair: 'X', interval: '1m', unix_time: 2, price: exitPrice,  signal: 'BUY' },
        { pair: 'X', interval: '1m', unix_time: 3, price: exitPrice,  signal: 'NEUTRAL' }
    ]
}

describe('calculateSignalProfit', () => {
    test('BUY with no fee equals raw delta', () => {
        expect(calculateSignalProfit('BUY', 100, 110, 0)).toBe(10)
    })

    test('STRONG BUY doubles delta and cost', () => {
        expect(calculateSignalProfit('STRONG BUY', 100, 110, 0)).toBe(20)
    })

    test('SELL profits when price falls', () => {
        expect(calculateSignalProfit('SELL', 100, 90, 0)).toBe(10)
    })

    test('NEUTRAL returns 0 regardless of price change', () => {
        expect(calculateSignalProfit('NEUTRAL', 100, 200, 0.001)).toBe(0)
    })

    test('fee is deducted on BUY', () => {
        expect(calculateSignalProfit('BUY', 100, 110, 0.001)).toBeCloseTo(9.79, 6)
    })

    test('inverted BUY flips direction before cost deduction', () => {
        expect(calculateSignalProfit('BUY', 100, 110, 0.001, 0, true)).toBeCloseTo(-10.21, 6)
    })

    test('slippage adds on top of fee on each leg', () => {
        expect(calculateSignalProfit('BUY', 100, 110, 0.001, 0.0005)).toBeCloseTo(9.685, 6)
    })

    test('STRONG SELL inverted with rising price', () => {
        // directionalDelta = (110-100)*-1 = -10. For SELL: -directionalDelta = 10
        // minus cost 0.21, times 2 = 19.58
        expect(calculateSignalProfit('STRONG SELL', 100, 110, 0.001, 0, true)).toBeCloseTo(19.58, 6)
    })
})

describe('analyseNdjson', () => {
    test('single BUY run (100→110→NEUTRAL) records 10 profit with no fee', async () => {
        const path = `${tempDir}/simple.ndjson`
        await writeRows(path, buyRun(100, 110))
        const result = await analyseNdjson(path, false, 0)
        expect(result?.profit_per_transaction.length).toBe(1)
        expect(result?.profit_per_transaction.at(0)).toBe(10)
        expect(result?.sum).toBe(10)
    })

    test('fee reduces profit consistently', async () => {
        const path = `${tempDir}/fee.ndjson`
        await writeRows(path, buyRun(100, 110))
        const result = await analyseNdjson(path, false, 0.001)
        expect(result?.sum).toBeCloseTo(9.79, 6)
    })

    test('inverted mode deducts fee (not credits it)', async () => {
        const path = `${tempDir}/inverted.ndjson`
        await writeRows(path, buyRun(100, 110))
        const result = await analyseNdjson(path, true, 0.001)
        expect(result?.sum).toBeCloseTo(-10.21, 6)
    })

    test('slippage adds to fee', async () => {
        const path = `${tempDir}/slip.ndjson`
        await writeRows(path, buyRun(100, 110))
        const result = await analyseNdjson(path, false, 0.001, undefined, 0.0005)
        expect(result?.sum).toBeCloseTo(9.685, 6)
    })

    test('backward compat: v1.x NDJSON (no indicators field) still parses', async () => {
        const path = `${tempDir}/v1.ndjson`
        await writeFile(path, [
            '{"pair":"X","interval":"1m","unix_time":1,"price":100,"signal":"BUY"}',
            '{"pair":"X","interval":"1m","unix_time":2,"price":110,"signal":"BUY"}',
            '{"pair":"X","interval":"1m","unix_time":3,"price":110,"signal":"NEUTRAL"}'
        ].join('\n') + '\n')
        const result = await analyseNdjson(path, false, 0)
        expect(result?.sum).toBe(10)
    })

    test('amount scales raw profits proportionally', async () => {
        const path = `${tempDir}/amount.ndjson`
        await writeRows(path, buyRun(100, 110))
        // rawProfit = 10; scaled by (amount / firstPrice) = 100/100 = 1 → still 10 USDT;
        // profitVariation = (10 / 100) * 100 = 10%
        const result = await analyseNdjson(path, false, 0, 100)
        expect(result?.sum).toBe(10)
        expect(result?.var).toBe('10%')
    })

    test('amount=200 doubles scaled profit', async () => {
        const path = `${tempDir}/amount2.ndjson`
        await writeRows(path, buyRun(100, 110))
        const result = await analyseNdjson(path, false, 0, 200)
        expect(result?.sum).toBe(20)
        expect(result?.var).toBe('10%')
    })

    test('open BUY position at EOF is closed at last price', async () => {
        const path = `${tempDir}/open-eof.ndjson`
        const rows: TickerRow[] = [
            { pair: 'X', interval: '1m', unix_time: 1, price: 100, signal: 'BUY' },
            { pair: 'X', interval: '1m', unix_time: 2, price: 105, signal: 'BUY' }
        ]
        await writeRows(path, rows)
        const result = await analyseNdjson(path, false, 0)
        expect(result?.profit_per_transaction.length).toBe(1)
        expect(result?.sum).toBe(5)
    })

    test('returns undefined for a single NEUTRAL row (nothing to evaluate)', async () => {
        const path = `${tempDir}/single-neutral.ndjson`
        const rows: TickerRow[] = [
            { pair: 'X', interval: '1m', unix_time: 1, price: 100, signal: 'NEUTRAL' }
        ]
        await writeRows(path, rows)
        const result = await analyseNdjson(path, false, 0)
        expect(result).toBeUndefined()
    })
})
