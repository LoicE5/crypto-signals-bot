import {
    SMA, EMA, WMA,
    RSI, MACD, ADX, Stochastic, StochasticRSI,
    WilliamsR, CCI, AwesomeOscillator, ROC,
    IchimokuCloud
} from 'technicalindicators'
import { OhlcvCandle, IndicatorReading, IndicatorVote } from '../types'
import { exoticReadings } from './indicators.exotic'

// ---------- helpers ---------------------------------------------------------

function extract(candles: OhlcvCandle[]): { open: number[], high: number[], low: number[], close: number[], volume: number[] } {
    const open:   number[] = []
    const high:   number[] = []
    const low:    number[] = []
    const close:  number[] = []
    const volume: number[] = []
    for(const candle of candles) {
        open.push(candle.open)
        high.push(candle.high)
        low.push(candle.low)
        close.push(candle.close)
        volume.push(candle.volume)
    }
    return { open, high, low, close, volume }
}

function lastTwo<T>(series: T[]): { previous: T | undefined, current: T | undefined } {
    return { previous: series.at(-2), current: series.at(-1) }
}

function maVote(close: number | undefined, ma: number | undefined): IndicatorVote {
    if(close === undefined || ma === undefined || !Number.isFinite(ma))
        return 0
    if(close > ma) return 1
    if(close < ma) return -1
    return 0
}

function makeMaReading(name: string, candles: OhlcvCandle[], period: number, calculator: (values: number[], period: number) => number[]): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < period)
        return { name, group: 'ma', value: undefined, vote: 0 }
    const series = calculator(close, period)
    const value = series.at(-1)
    return { name, group: 'ma', value, vote: maVote(close.at(-1), value) }
}

// ---------- moving averages (15) -------------------------------------------

function smaSeries(values: number[], period: number): number[] {
    return SMA.calculate({ values, period })
}

function emaSeries(values: number[], period: number): number[] {
    return EMA.calculate({ values, period })
}

function wmaSeries(values: number[], period: number): number[] {
    return WMA.calculate({ values, period })
}

// Hull MA: WMA(2*WMA(n/2) − WMA(n), sqrt(n))
function hmaSeries(values: number[], period: number): number[] {
    if(values.length < period)
        return []
    const halfWma = wmaSeries(values, Math.floor(period / 2))
    const fullWma = wmaSeries(values, period)
    const offset  = fullWma.length - halfWma.length
    const diff: number[] = []
    for(let i = 0; i < fullWma.length; i++) {
        const half = halfWma.at(i - offset)
        const full = fullWma.at(i)
        if(half === undefined || full === undefined)
            continue
        diff.push(2 * half - full)
    }
    return wmaSeries(diff, Math.max(1, Math.round(Math.sqrt(period))))
}

// Volume-Weighted MA
function vwmaSeries(close: number[], volume: number[], period: number): number[] {
    const out: number[] = []
    if(close.length < period || volume.length < period)
        return out
    for(let i = period - 1; i < close.length; i++) {
        let numerator = 0
        let denominator = 0
        for(let j = i - period + 1; j <= i; j++) {
            const priceAt = close.at(j) ?? 0
            const volAt   = volume.at(j) ?? 0
            numerator += priceAt * volAt
            denominator += volAt
        }
        out.push(denominator === 0 ? 0 : numerator / denominator)
    }
    return out
}

const MA_PERIODS = [10, 20, 30, 50, 100, 200] as const

export function movingAverageReadings(candles: OhlcvCandle[]): IndicatorReading[] {
    const readings: IndicatorReading[] = []

    for(const period of MA_PERIODS)
        readings.push(makeMaReading(`SMA${period}`, candles, period, smaSeries))

    for(const period of MA_PERIODS)
        readings.push(makeMaReading(`EMA${period}`, candles, period, emaSeries))

    // Hull MA (9)
    const { close, volume } = extract(candles)
    const hmaValue = hmaSeries(close, 9).at(-1)
    readings.push({ name: 'HMA9', group: 'ma', value: hmaValue, vote: maVote(close.at(-1), hmaValue) })

    // VWMA (20)
    const vwmaValue = vwmaSeries(close, volume, 20).at(-1)
    readings.push({ name: 'VWMA20', group: 'ma', value: vwmaValue, vote: maVote(close.at(-1), vwmaValue) })

    // Ichimoku — bull if close > cloud top AND conversion > base; bear if opposite
    readings.push(ichimokuReading(candles))

    return readings
}

function ichimokuReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low } = extract(candles)
    if(high.length < 52)
        return { name: 'Ichimoku', group: 'ma', value: undefined, vote: 0 }

    const cloud = IchimokuCloud.calculate({
        high, low,
        conversionPeriod: 9,
        basePeriod: 26,
        spanPeriod: 52,
        displacement: 26
    })
    const latest = cloud.at(-1)
    const closePrice = candles.at(-1)?.close
    if(latest === undefined || closePrice === undefined)
        return { name: 'Ichimoku', group: 'ma', value: undefined, vote: 0 }

    const cloudTop    = Math.max(latest.spanA, latest.spanB)
    const cloudBottom = Math.min(latest.spanA, latest.spanB)

    let vote: IndicatorVote = 0
    if(closePrice > cloudTop && latest.conversion > latest.base) vote = 1
    else if(closePrice < cloudBottom && latest.conversion < latest.base) vote = -1

    return { name: 'Ichimoku', group: 'ma', value: latest.conversion, vote }
}

// ---------- oscillators (11) -----------------------------------------------

function rsiReading(candles: OhlcvCandle[]): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < 15)
        return { name: 'RSI14', group: 'oscillator', value: undefined, vote: 0 }
    const series = RSI.calculate({ values: close, period: 14 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'RSI14', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current < 30 && (previous === undefined || current > previous)) vote = 1
    else if(current > 70 && (previous === undefined || current < previous)) vote = -1
    return { name: 'RSI14', group: 'oscillator', value: current, vote }
}

function stochasticReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low, close } = extract(candles)
    if(close.length < 17)
        return { name: 'Stoch', group: 'oscillator', value: undefined, vote: 0 }
    const series = Stochastic.calculate({ high, low, close, period: 14, signalPeriod: 3 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'Stoch', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current.k < 20 && current.k > current.d && (previous === undefined || current.k > previous.k)) vote = 1
    else if(current.k > 80 && current.k < current.d && (previous === undefined || current.k < previous.k)) vote = -1
    return { name: 'Stoch', group: 'oscillator', value: current.k, vote }
}

function cciReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low, close } = extract(candles)
    if(close.length < 21)
        return { name: 'CCI20', group: 'oscillator', value: undefined, vote: 0 }
    const series = CCI.calculate({ high, low, close, period: 20 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'CCI20', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current < -100 && (previous === undefined || current > previous)) vote = 1
    else if(current > 100 && (previous === undefined || current < previous)) vote = -1
    return { name: 'CCI20', group: 'oscillator', value: current, vote }
}

function adxReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low, close } = extract(candles)
    if(close.length < 28)
        return { name: 'ADX14', group: 'oscillator', value: undefined, vote: 0 }
    const series = ADX.calculate({ high, low, close, period: 14 })
    const current = series.at(-1)
    if(current === undefined)
        return { name: 'ADX14', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current.adx > 20) {
        if(current.pdi > current.mdi)      vote = 1
        else if(current.mdi > current.pdi) vote = -1
    }
    return { name: 'ADX14', group: 'oscillator', value: current.adx, vote }
}

function awesomeReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low } = extract(candles)
    if(high.length < 34)
        return { name: 'AO', group: 'oscillator', value: undefined, vote: 0 }
    const series = AwesomeOscillator.calculate({ high, low, fastPeriod: 5, slowPeriod: 34 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'AO', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current > 0 && (previous === undefined || current > previous)) vote = 1
    else if(current < 0 && (previous === undefined || current < previous)) vote = -1
    return { name: 'AO', group: 'oscillator', value: current, vote }
}

function momentumReading(candles: OhlcvCandle[]): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < 11)
        return { name: 'MOM10', group: 'oscillator', value: undefined, vote: 0 }
    const series = ROC.calculate({ values: close, period: 10 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'MOM10', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current > 0 && (previous === undefined || current > previous)) vote = 1
    else if(current < 0 && (previous === undefined || current < previous)) vote = -1
    return { name: 'MOM10', group: 'oscillator', value: current, vote }
}

function macdReading(candles: OhlcvCandle[]): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < 35)
        return { name: 'MACD', group: 'oscillator', value: undefined, vote: 0 }
    const series = MACD.calculate({
        values: close,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    })
    const current = series.at(-1)
    if(current === undefined || current.MACD === undefined || current.signal === undefined)
        return { name: 'MACD', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current.MACD > current.signal) vote = 1
    else if(current.MACD < current.signal) vote = -1
    return { name: 'MACD', group: 'oscillator', value: current.MACD, vote }
}

function stochasticRsiReading(candles: OhlcvCandle[]): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < 32)
        return { name: 'StochRSI', group: 'oscillator', value: undefined, vote: 0 }
    const series = StochasticRSI.calculate({
        values: close,
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3
    })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'StochRSI', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current.k < 20 && current.k > current.d && (previous === undefined || current.k > previous.k)) vote = 1
    else if(current.k > 80 && current.k < current.d && (previous === undefined || current.k < previous.k)) vote = -1
    return { name: 'StochRSI', group: 'oscillator', value: current.k, vote }
}

function williamsReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low, close } = extract(candles)
    if(close.length < 15)
        return { name: 'Williams%R', group: 'oscillator', value: undefined, vote: 0 }
    const series = WilliamsR.calculate({ high, low, close, period: 14 })
    const { previous, current } = lastTwo(series)
    if(current === undefined)
        return { name: 'Williams%R', group: 'oscillator', value: undefined, vote: 0 }
    let vote: IndicatorVote = 0
    if(current < -80 && (previous === undefined || current > previous)) vote = 1
    else if(current > -20 && (previous === undefined || current < previous)) vote = -1
    return { name: 'Williams%R', group: 'oscillator', value: current, vote }
}

// Elder's Bull Bear Power: bull = high − EMA(13); bear = low − EMA(13)
// TradingView rule: BUY when bear < 0 AND bear rising; SELL when bull > 0 AND bull falling.
function bullBearPowerReading(candles: OhlcvCandle[]): IndicatorReading {
    const { high, low, close } = extract(candles)
    if(close.length < 14)
        return { name: 'BBP13', group: 'oscillator', value: undefined, vote: 0 }
    const emaSeriesClose = EMA.calculate({ values: close, period: 13 })
    const offset = close.length - emaSeriesClose.length
    const bullSeries: number[] = []
    const bearSeries: number[] = []
    for(let i = 0; i < emaSeriesClose.length; i++) {
        const emaValue = emaSeriesClose.at(i)
        const highValue = high.at(i + offset)
        const lowValue  = low.at(i + offset)
        if(emaValue === undefined || highValue === undefined || lowValue === undefined)
            continue
        bullSeries.push(highValue - emaValue)
        bearSeries.push(lowValue - emaValue)
    }
    const bullNow  = bullSeries.at(-1)
    const bullPrev = bullSeries.at(-2)
    const bearNow  = bearSeries.at(-1)
    const bearPrev = bearSeries.at(-2)
    if(bullNow === undefined || bearNow === undefined)
        return { name: 'BBP13', group: 'oscillator', value: undefined, vote: 0 }

    let vote: IndicatorVote = 0
    if(bearNow < 0 && (bearPrev === undefined || bearNow > bearPrev)) vote = 1
    else if(bullNow > 0 && (bullPrev === undefined || bullNow < bullPrev)) vote = -1
    return { name: 'BBP13', group: 'oscillator', value: bullNow + bearNow, vote }
}

// Ultimate Oscillator (Larry Williams, periods 7/14/28)
function ultimateOscillatorReading(candles: OhlcvCandle[]): IndicatorReading {
    const lengthNeeded = 29
    if(candles.length < lengthNeeded)
        return { name: 'UO', group: 'oscillator', value: undefined, vote: 0 }

    const bp: number[] = []   // buying pressure
    const tr: number[] = []   // true range
    for(let i = 1; i < candles.length; i++) {
        const currentCandle  = candles.at(i)
        const previousCandle = candles.at(i - 1)
        if(currentCandle === undefined || previousCandle === undefined)
            continue
        const trueLow  = Math.min(currentCandle.low,  previousCandle.close)
        const trueHigh = Math.max(currentCandle.high, previousCandle.close)
        bp.push(currentCandle.close - trueLow)
        tr.push(trueHigh - trueLow)
    }

    function averageRatio(period: number): number | undefined {
        if(bp.length < period) return undefined
        let bpSum = 0
        let trSum = 0
        for(let i = bp.length - period; i < bp.length; i++) {
            bpSum += bp.at(i) ?? 0
            trSum += tr.at(i) ?? 0
        }
        return trSum === 0 ? 0 : bpSum / trSum
    }

    const avg7  = averageRatio(7)
    const avg14 = averageRatio(14)
    const avg28 = averageRatio(28)
    if(avg7 === undefined || avg14 === undefined || avg28 === undefined)
        return { name: 'UO', group: 'oscillator', value: undefined, vote: 0 }

    const uo = 100 * (4 * avg7 + 2 * avg14 + avg28) / 7
    let vote: IndicatorVote = 0
    if(uo < 30) vote = 1
    else if(uo > 70) vote = -1
    return { name: 'UO', group: 'oscillator', value: uo, vote }
}

export function oscillatorReadings(candles: OhlcvCandle[]): IndicatorReading[] {
    return [
        rsiReading(candles),
        stochasticReading(candles),
        cciReading(candles),
        adxReading(candles),
        awesomeReading(candles),
        momentumReading(candles),
        macdReading(candles),
        stochasticRsiReading(candles),
        williamsReading(candles),
        bullBearPowerReading(candles),
        ultimateOscillatorReading(candles)
    ]
}

export function allReadings(candles: OhlcvCandle[], options: { exotic?: boolean } = {}): IndicatorReading[] {
    const base = [...movingAverageReadings(candles), ...oscillatorReadings(candles)]
    return options.exotic ? [...base, ...exoticReadings(candles)] : base
}
