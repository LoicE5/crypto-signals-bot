import { mkdir } from 'node:fs/promises'
import { validIntervals, OHLCV_LIMIT } from '../constants'
import { fetchOhlcv, getLastPrice, isPairValid } from '../signals/market'
import { computeComposite } from '../signals/aggregator'
import { getValueFromArgv, getPositionalArg, isArgv } from '../lib/argv'
import { appendLine, writeFile } from '../lib/ndjson'
import { writeLogger } from '../lib/logger'
import { TickerRow } from '../types'

export async function runWrite(argv: string[], commandIndex: number): Promise<void> {
    const flagPair = getValueFromArgv('--pair', argv)
    const positional = getPositionalArg(argv, commandIndex)
    if(flagPair !== null && positional !== null)
        console.warn(`Both positional "${positional}" and --pair="${flagPair}" supplied; using --pair.`)
    const pair = flagPair ?? positional
    const interval = getValueFromArgv('--interval', argv) ?? '1m'
    const delay = Number(getValueFromArgv('--delay', argv)) || 10
    const logIndicators = isArgv('--indicators', argv)
    const exotic = isArgv('--exotic', argv) || isArgv('--exotic-indicators', argv)

    if(!pair) {
        console.error('--pair (or positional first argument) is required for the write command')
        process.exit(1)
    }

    if(!validIntervals.has(interval)) {
        console.error(`Invalid interval "${interval}". Allowed: ${[...validIntervals].join(', ')}`)
        process.exit(1)
    }

    if(!await isPairValid(pair)) {
        console.error(`Invalid pair "${pair}". Make sure it exists on Binance.`)
        process.exit(1)
    }

    await mkdir('./output', { recursive: true })
    const date = new Date()
    const fileName = `output/${pair}_${interval}_${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}.ndjson`
    await writeFile(fileName, '')
    console.info(`Writing to ${fileName} every ${delay}s — press Ctrl+C to stop.`)

    const tick = async (): Promise<void> => {
        try {
            const candles = await fetchOhlcv(pair, interval, OHLCV_LIMIT)
            const composite = computeComposite(candles, { exotic })
            const row: TickerRow = {
                pair,
                interval,
                unix_time: Date.now(),
                price: await getLastPrice(pair),
                signal: composite.signal
            }
            if(exotic)
                row.exoticRating = composite.exoticRating
            if(logIndicators)
                row.indicators = composite.readings
            writeLogger(row)
            await appendLine(fileName, JSON.stringify(row))
        } catch(tickError: unknown) {
            console.error('Failed to write row:', tickError)
        }
    }

    await tick()
    setInterval(tick, delay * 1000)
}
