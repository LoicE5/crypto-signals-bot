import { AnalysisResult, SignalValue, TickerRow } from '../types'
import { EXCHANGE_FEES } from '../constants'
import { defaultExchange } from '../signals/market'
import { readNdjson } from '../lib/ndjson'

// Net profit for one completed signal run after round-trip execution costs.
// When inverted=true, direction is flipped BEFORE costs are deducted so that
// fees + slippage remain a debit in both modes. STRONG signals double both
// P&L and costs (2× leverage).
export function calculateSignalProfit(
    signal: SignalValue | undefined,
    firstPrice: number,
    lastPrice: number,
    feeRate: number,
    slippageRate: number = 0,
    inverted: boolean = false
): number {
    const directionalDelta = (lastPrice - firstPrice) * (inverted ? -1 : 1)
    const roundTripCost = (feeRate + slippageRate) * (firstPrice + lastPrice)
    switch(signal) {
        case 'BUY':         return  directionalDelta - roundTripCost
        case 'STRONG BUY':  return (directionalDelta - roundTripCost) * 2
        case 'NEUTRAL':     return 0
        case 'SELL':        return -directionalDelta - roundTripCost
        case 'STRONG SELL': return (-directionalDelta - roundTripCost) * 2
        default:            return 0
    }
}

export async function analyseNdjson(
    pathToFile: string,
    inverted: boolean = false,
    feeRate: number = EXCHANGE_FEES[defaultExchange.id] ?? 0,
    amount: number | undefined = undefined,
    slippageRate: number = 0
): Promise<AnalysisResult | undefined> {
    const rows = await readNdjson<TickerRow>(pathToFile)

    let firstPrice: number | undefined
    let absoluteFirstPrice: number | undefined
    let currentSignal: SignalValue | undefined
    const profits: number[] = []

    for(const [index, row] of rows.entries()) {
        const nextRow = rows.at(index + 1)
        if(row === undefined || nextRow === undefined)
            break

        if(index === 0) {
            firstPrice = row.price
            absoluteFirstPrice = row.price
            currentSignal = row.signal
        }

        if(firstPrice === undefined || row.price === undefined)
            continue

        if(row.signal === nextRow.signal)
            continue

        const lastPrice = row.price
        const rawProfit = calculateSignalProfit(row.signal, firstPrice, lastPrice, feeRate, slippageRate, inverted)
        profits.push(amount !== undefined ? rawProfit * (amount / firstPrice) : rawProfit)
        firstPrice = nextRow.price
        currentSignal = nextRow.signal
    }

    // Close any open position at the last data point
    const lastRow = rows.at(-1)
    if(
        firstPrice !== undefined &&
        currentSignal !== undefined &&
        currentSignal !== 'NEUTRAL' &&
        currentSignal !== 'ERROR' &&
        lastRow?.price !== undefined
    ) {
        const rawProfit = calculateSignalProfit(currentSignal, firstPrice, lastRow.price, feeRate, slippageRate, inverted)
        profits.push(amount !== undefined ? rawProfit * (amount / firstPrice) : rawProfit)
    }

    if(profits.length === 0) {
        console.warn("There is no change of signal in the given file. Therefore, it isn't possible to calculate a profit.")
        return undefined
    }

    const profitSum = profits.reduce((accumulator: number, currentValue: number): number => accumulator + currentValue)
    if(absoluteFirstPrice === undefined)
        return undefined

    const profitVariation = (profitSum / (amount ?? absoluteFirstPrice)) * 100

    return {
        profit_per_transaction: profits,
        sum: profitSum,
        var: profitVariation + '%'
    } satisfies AnalysisResult
}
