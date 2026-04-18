import * as clack from '@clack/prompts'
import { validIntervals, OHLCV_LIMIT } from './constants'
import { fetchOhlcv, getLastPrice, isPairValid } from './signals/market'
import { computeComposite } from './signals/aggregator'
import { analyseNdjson } from './analysis/roi'
import { simulateLogger, writeLogger } from './lib/logger'
import { appendLine, writeFile } from './lib/ndjson'
import { TickerRow } from './types'
import { mkdir } from 'node:fs/promises'

export async function discoverNdjsonFiles(): Promise<string[]> {
    const glob = new Bun.Glob('**/*.ndjson')
    const files: string[] = []
    for await(const file of glob.scan({ cwd: process.cwd() })) {
        if(!file.startsWith('node_modules/'))
            files.push(`./${file}`)
    }
    return files.sort()
}

async function promptPairAndInterval(): Promise<{ pair: string, interval: string } | undefined> {
    const pair = await clack.text({
        message: 'Cryptocurrency pair',
        placeholder: 'BTCUSDT',
        validate: value => !value?.trim() ? 'Pair is required' : undefined
    })
    if(clack.isCancel(pair)) return undefined

    const interval = await clack.select({
        message: 'Interval',
        options: [...validIntervals].map(value => ({ value, label: value }))
    })
    if(clack.isCancel(interval)) return undefined

    return { pair: pair as string, interval: interval as string }
}

export async function runCli(): Promise<void> {
    clack.intro('Crypto Signals Bot')

    const command = await clack.select({
        message: 'What would you like to do?',
        options: [
            { value: 'simulate', label: 'simulate', hint: 'print live price + composite signal on a loop' },
            { value: 'write',    label: 'write',    hint: 'record price + signal to .ndjson file' },
            { value: 'analyze',  label: 'analyze',  hint: 'estimate ROI from a .ndjson file' }
        ]
    })

    if(clack.isCancel(command)) {
        clack.cancel('Cancelled.')
        return
    }

    if(command === 'analyze') {
        const files = await discoverNdjsonFiles()

        if(files.length === 0) {
            clack.log.warn('No .ndjson files found in the current directory tree.')
            clack.outro('Nothing to analyze.')
            return
        }

        const filePath = await clack.select({
            message: 'Select a .ndjson file',
            options: files.map(file => ({ value: file, label: file }))
        })
        if(clack.isCancel(filePath)) { clack.cancel('Cancelled.'); return }

        const inverted = await clack.confirm({
            message: 'Invert strategy? (short on BUY, long on SELL)',
            initialValue: false
        })
        if(clack.isCancel(inverted)) { clack.cancel('Cancelled.'); return }

        const spinner = clack.spinner()
        spinner.start('Analyzing…')

        try {
            const result = await analyseNdjson(filePath as string, inverted as boolean)
            spinner.stop('Analysis complete')
            if(result === undefined) {
                clack.log.warn('No signal changes found — cannot compute profit.')
            } else {
                clack.log.info(`Transactions : ${result.profit_per_transaction.length}`)
                clack.log.info(`Sum          : ${result.sum}`)
                clack.log.info(`Variation    : ${result.var}`)
            }
        } catch(analyzeError: unknown) {
            spinner.stop('Analysis failed')
            clack.log.error(String(analyzeError))
        }

        clack.outro('Done.')
        return
    }

    const pairInterval = await promptPairAndInterval()
    if(!pairInterval) { clack.cancel('Cancelled.'); return }
    const { pair, interval } = pairInterval

    const spinner = clack.spinner()
    spinner.start('Validating pair on Binance…')
    const valid = await isPairValid(pair)
    if(!valid) {
        spinner.stop('Validation failed')
        clack.log.error(`"${pair}" was not found on Binance.`)
        clack.outro('Aborted.')
        return
    }
    spinner.stop('Pair validated')

    if(command === 'write') {
        const delayInput = await clack.text({
            message: 'Delay between records (seconds)',
            placeholder: '10',
            initialValue: '10',
            validate: value => {
                const num = Number(value)
                return isNaN(num) || num <= 0 ? 'Must be a positive number' : undefined
            }
        })
        if(clack.isCancel(delayInput)) { clack.cancel('Cancelled.'); return }

        const logIndicators = await clack.confirm({
            message: 'Include full per-indicator breakdown in each row? (bigger files, richer analysis)',
            initialValue: false
        })
        if(clack.isCancel(logIndicators)) { clack.cancel('Cancelled.'); return }

        const delay = Number(delayInput) || 10
        await mkdir('./output', { recursive: true })
        const date = new Date()
        const fileName = `output/${pair}_${interval}_${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}.ndjson`
        await writeFile(fileName, '')

        clack.outro(`Writing ${pair} @ ${interval} every ${delay}s to ${fileName} — press Ctrl+C to stop.`)

        const tick = async (): Promise<void> => {
            try {
                const candles = await fetchOhlcv(pair, interval, OHLCV_LIMIT)
                const composite = computeComposite(candles)
                const row: TickerRow = {
                    pair,
                    interval,
                    unix_time: Date.now(),
                    price: await getLastPrice(pair),
                    signal: composite.signal
                }
                if(logIndicators)
                    row.indicators = composite.readings
                writeLogger(row)
                await appendLine(fileName, JSON.stringify(row))
            } catch(writeError: unknown) {
                console.error('Failed to write row:', writeError)
            }
        }

        await tick()
        setInterval(tick, delay * 1000)
        return
    }

    // simulate
    clack.outro(`Simulating ${pair} @ ${interval} — press Ctrl+C to stop.`)
    const tick = async (): Promise<void> => {
        try {
            const candles = await fetchOhlcv(pair, interval, OHLCV_LIMIT)
            const composite = computeComposite(candles)
            const price = await getLastPrice(pair)
            simulateLogger(
                `Pair: ${pair} | Interval: ${interval} | Price: ${price} | ` +
                `Signal: ${composite.signal} (score ${composite.score.toFixed(3)})`
            )
        } catch(simulateError: unknown) {
            console.error('Simulate tick failed:', simulateError)
        }
    }
    await tick()
    setInterval(tick, 1000)
}
