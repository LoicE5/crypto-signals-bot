import { validIntervals, OHLCV_LIMIT } from '../constants'
import { fetchOhlcv, getLastPrice, isPairValid } from '../signals/market'
import { computeComposite } from '../signals/aggregator'
import { getValueFromArgv, getPositionalArg } from '../lib/argv'
import { simulateLogger } from '../lib/logger'

function formatReadings(composite: ReturnType<typeof computeComposite>): string {
    const votes = composite.readings.map(reading => {
        const mark = reading.vote === 1 ? '+' : reading.vote === -1 ? '-' : '·'
        return `${reading.name}${mark}`
    })
    return votes.join(' ')
}

export async function runSimulate(argv: string[], commandIndex: number): Promise<void> {
    const flagPair = getValueFromArgv('--pair', argv)
    const positional = getPositionalArg(argv, commandIndex)
    if(flagPair !== null && positional !== null)
        console.warn(`Both positional "${positional}" and --pair="${flagPair}" supplied; using --pair.`)
    const pair = flagPair ?? positional
    const interval = getValueFromArgv('--interval', argv) ?? '1m'

    if(!pair) {
        console.error('--pair (or positional first argument) is required for the simulate command')
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

    const tick = async (): Promise<void> => {
        try {
            const candles = await fetchOhlcv(pair, interval, OHLCV_LIMIT)
            const composite = computeComposite(candles)
            const price = await getLastPrice(pair)
            simulateLogger(
                `Pair: ${pair} | Interval: ${interval} | Price: ${price} | ` +
                `Signal: ${composite.signal} (score ${composite.score.toFixed(3)}) | ` +
                `MA: ${composite.maRating.toFixed(2)} Osc: ${composite.oscRating.toFixed(2)} | ` +
                formatReadings(composite)
            )
        } catch(tickError: unknown) {
            console.error('Simulate tick failed:', tickError)
        }
    }

    await tick()
    setInterval(tick, 1000)
}
