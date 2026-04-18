import { SMA, RSI, BollingerBands } from 'technicalindicators'
import { OhlcvCandle, IndicatorReading, IndicatorVote } from '../types'

// ---------- shared helpers -------------------------------------------------

function extract(candles: OhlcvCandle[]): { high: number[], low: number[], close: number[] } {
    const high:  number[] = []
    const low:   number[] = []
    const close: number[] = []
    for(const candle of candles) {
        high.push(candle.high)
        low.push(candle.low)
        close.push(candle.close)
    }
    return { high, low, close }
}

function trueRangeSeries(candles: OhlcvCandle[]): number[] {
    const tr: number[] = []
    for(let i = 1; i < candles.length; i++) {
        const current  = candles.at(i)
        const previous = candles.at(i - 1)
        if(current === undefined || previous === undefined) continue
        tr.push(Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low  - previous.close)
        ))
    }
    return tr
}

// +1 if close > SMA20, -1 if below, 0 otherwise. Used to synthesize a
// direction for regime-style readings (Hurst, Choppiness) that don't
// themselves produce a directional signal.
function directionProxy(candles: OhlcvCandle[]): IndicatorVote {
    const { close } = extract(candles)
    if(close.length < 20) return 0
    const sma = SMA.calculate({ values: close, period: 20 })
    const smaNow   = sma.at(-1)
    const closeNow = close.at(-1)
    if(smaNow === undefined || closeNow === undefined) return 0
    if(closeNow > smaNow) return 1
    if(closeNow < smaNow) return -1
    return 0
}

// ---------- Hurst Exponent (rolling R/S on log returns) --------------------

function hurstExponent(series: number[]): number | undefined {
    const returns: number[] = []
    for(let i = 1; i < series.length; i++) {
        const previous = series.at(i - 1)
        const current  = series.at(i)
        if(previous === undefined || current === undefined) continue
        if(previous <= 0 || current <= 0) continue
        returns.push(Math.log(current / previous))
    }
    if(returns.length < 32) return undefined

    const lags: number[] = []
    for(let lag = 8; lag <= Math.floor(returns.length / 2); lag = Math.floor(lag * 1.5))
        lags.push(lag)
    if(lags.length < 2) return undefined

    const logLags: number[] = []
    const logRS:   number[] = []

    for(const lag of lags) {
        const chunkCount = Math.floor(returns.length / lag)
        let rsSum = 0
        let rsCount = 0
        for(let chunk = 0; chunk < chunkCount; chunk++) {
            const start = chunk * lag
            let sum = 0
            for(let j = start; j < start + lag; j++) sum += returns[j] ?? 0
            const chunkMean = sum / lag

            let cumulative = 0
            let maxY = -Infinity
            let minY =  Infinity
            let varianceSum = 0
            for(let j = start; j < start + lag; j++) {
                const deviation = (returns[j] ?? 0) - chunkMean
                cumulative += deviation
                if(cumulative > maxY) maxY = cumulative
                if(cumulative < minY) minY = cumulative
                varianceSum += deviation * deviation
            }
            const range = maxY - minY
            const stddev = Math.sqrt(varianceSum / lag)
            if(range > 0 && stddev > 0) {
                rsSum += range / stddev
                rsCount++
            }
        }
        if(rsCount > 0) {
            logLags.push(Math.log(lag))
            logRS.push(Math.log(rsSum / rsCount))
        }
    }
    if(logLags.length < 2) return undefined

    // Slope of linear regression log(R/S) on log(lag) = H
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    const n = logLags.length
    for(let i = 0; i < n; i++) {
        sumX  += logLags[i] ?? 0
        sumY  += logRS[i]   ?? 0
        sumXY += (logLags[i] ?? 0) * (logRS[i] ?? 0)
        sumXX += (logLags[i] ?? 0) * (logLags[i] ?? 0)
    }
    const denominator = n * sumXX - sumX * sumX
    if(denominator === 0) return undefined
    return (n * sumXY - sumX * sumY) / denominator
}

function hurstReading(candles: OhlcvCandle[], window = 100): IndicatorReading {
    const { close } = extract(candles)
    if(close.length < window)
        return { name: 'Hurst100', group: 'exotic', value: undefined, vote: 0 }

    const h = hurstExponent(close.slice(-window))
    if(h === undefined || !Number.isFinite(h))
        return { name: 'Hurst100', group: 'exotic', value: undefined, vote: 0 }

    let vote: IndicatorVote = 0
    if(h > 0.55) {
        const direction = directionProxy(candles)
        if(direction > 0) vote = 1
        else if(direction < 0) vote = -1
    } else if(h < 0.45) {
        // Anti-persistent: expect reversion. Vote opposite the last bar's move.
        const closeNow  = close.at(-1)
        const closePrev = close.at(-2)
        if(closeNow !== undefined && closePrev !== undefined) {
            if(closeNow > closePrev) vote = -1
            else if(closeNow < closePrev) vote = 1
        }
    }

    return { name: 'Hurst100', group: 'exotic', value: h, vote }
}

// ---------- Connors RSI (CRSI 3 / 2 / 100) ---------------------------------

function streakSeries(close: number[]): number[] {
    const streak: number[] = [0]
    for(let i = 1; i < close.length; i++) {
        const diff = (close[i] ?? 0) - (close[i - 1] ?? 0)
        const previous = streak[i - 1] ?? 0
        if(diff > 0)      streak.push(previous > 0 ? previous + 1 : 1)
        else if(diff < 0) streak.push(previous < 0 ? previous - 1 : -1)
        else              streak.push(0)
    }
    return streak
}

function connorsRsiReading(candles: OhlcvCandle[]): IndicatorReading {
    const { close } = extract(candles)
    const minBars = 104
    if(close.length < minBars)
        return { name: 'CRSI', group: 'exotic', value: undefined, vote: 0 }

    const rsi3       = RSI.calculate({ values: close, period: 3 })
    const rsiStreak2 = RSI.calculate({ values: streakSeries(close), period: 2 })

    const roc1: number[] = []
    for(let i = 1; i < close.length; i++) {
        const previous = close[i - 1] ?? 0
        if(previous === 0) { roc1.push(0); continue }
        roc1.push(((close[i] ?? 0) / previous - 1) * 100)
    }
    if(roc1.length < 100)
        return { name: 'CRSI', group: 'exotic', value: undefined, vote: 0 }

    const currentRoc = roc1.at(-1)
    if(currentRoc === undefined)
        return { name: 'CRSI', group: 'exotic', value: undefined, vote: 0 }

    const window = roc1.slice(-100, -1) // 99 past values, excludes current
    let lessThan = 0
    for(const value of window) if(value < currentRoc) lessThan++
    const percentRank = window.length === 0 ? 50 : (lessThan / window.length) * 100

    const rsi3Now       = rsi3.at(-1)
    const rsiStreak2Now = rsiStreak2.at(-1)
    if(rsi3Now === undefined || rsiStreak2Now === undefined)
        return { name: 'CRSI', group: 'exotic', value: undefined, vote: 0 }

    const crsi = (rsi3Now + rsiStreak2Now + percentRank) / 3
    let vote: IndicatorVote = 0
    if(crsi < 10)      vote = 1
    else if(crsi > 90) vote = -1
    return { name: 'CRSI', group: 'exotic', value: crsi, vote }
}

// ---------- Choppiness Index (14) ------------------------------------------

function choppinessIndexReading(candles: OhlcvCandle[]): IndicatorReading {
    const period = 14
    if(candles.length < period + 1)
        return { name: 'CHOP14', group: 'exotic', value: undefined, vote: 0 }

    const tr = trueRangeSeries(candles)
    const trWindow = tr.slice(-period)
    let trSum = 0
    for(const value of trWindow) trSum += value

    let maxHigh = -Infinity
    let minLow  =  Infinity
    for(let i = candles.length - period; i < candles.length; i++) {
        const candle = candles.at(i)
        if(candle === undefined) continue
        if(candle.high > maxHigh) maxHigh = candle.high
        if(candle.low  < minLow)  minLow  = candle.low
    }
    const range = maxHigh - minLow
    if(range <= 0 || trSum <= 0)
        return { name: 'CHOP14', group: 'exotic', value: undefined, vote: 0 }

    const ci = 100 * Math.log10(trSum / range) / Math.log10(period)

    let vote: IndicatorVote = 0
    if(ci < 38.2) {
        const direction = directionProxy(candles)
        if(direction > 0) vote = 1
        else if(direction < 0) vote = -1
    }
    return { name: 'CHOP14', group: 'exotic', value: ci, vote }
}

// ---------- Ehlers Fisher Transform (10) -----------------------------------

function fisherTransformReading(candles: OhlcvCandle[]): IndicatorReading {
    const period = 10
    if(candles.length < period + 3)
        return { name: 'Fisher10', group: 'exotic', value: undefined, vote: 0 }

    const mid: number[] = []
    for(const candle of candles) mid.push((candle.high + candle.low) / 2)

    const value:  number[] = new Array(mid.length).fill(0)
    const fisher: number[] = new Array(mid.length).fill(0)

    for(let i = period - 1; i < mid.length; i++) {
        let maxH = -Infinity
        let minL =  Infinity
        for(let j = i - period + 1; j <= i; j++) {
            const midAt = mid[j] ?? 0
            if(midAt > maxH) maxH = midAt
            if(midAt < minL) minL = midAt
        }
        const range = maxH - minL
        const previousValue  = value[i - 1]  ?? 0
        const previousFisher = fisher[i - 1] ?? 0
        let normalized = range <= 0
            ? 0
            : 0.33 * 2 * (((mid[i] ?? 0) - minL) / range - 0.5) + 0.67 * previousValue
        if(normalized >  0.999) normalized =  0.999
        if(normalized < -0.999) normalized = -0.999
        value[i]  = normalized
        fisher[i] = 0.5 * Math.log((1 + normalized) / (1 - normalized)) + 0.5 * previousFisher
    }

    const current = fisher.at(-1)
    const previous = fisher.at(-2)
    const previous2 = fisher.at(-3)
    if(current === undefined || previous === undefined || previous2 === undefined)
        return { name: 'Fisher10', group: 'exotic', value: current, vote: 0 }

    // Turning-point detection: +1 when fisher turns up, -1 when it turns down.
    let vote: IndicatorVote = 0
    if(previous < previous2 && current > previous) vote = 1
    else if(previous > previous2 && current < previous) vote = -1

    return { name: 'Fisher10', group: 'exotic', value: current, vote }
}

// ---------- TTM Squeeze (BB 20/2 vs KC 20/1.5 + linreg(20) momentum) -------

function ttmSqueezeReading(candles: OhlcvCandle[]): IndicatorReading {
    const period = 20
    const kcMult = 1.5
    if(candles.length < period + 2)
        return { name: 'TTMSqz', group: 'exotic', value: undefined, vote: 0 }

    const { close } = extract(candles)
    const bb  = BollingerBands.calculate({ period, stdDev: 2, values: close })
    const tr  = trueRangeSeries(candles)
    const atr = SMA.calculate({ values: tr, period })
    const smaClose = SMA.calculate({ values: close, period })

    const bbNow    = bb.at(-1)
    const bbPrev   = bb.at(-2)
    const atrNow   = atr.at(-1)
    const atrPrev  = atr.at(-2)
    const smaNow   = smaClose.at(-1)
    const smaPrev  = smaClose.at(-2)
    if(
        bbNow === undefined || bbPrev === undefined ||
        atrNow === undefined || atrPrev === undefined ||
        smaNow === undefined || smaPrev === undefined
    )
        return { name: 'TTMSqz', group: 'exotic', value: undefined, vote: 0 }

    const squeezeOnNow  = bbNow.upper  < smaNow  + kcMult * atrNow  && bbNow.lower  > smaNow  - kcMult * atrNow
    const squeezeOnPrev = bbPrev.upper < smaPrev + kcMult * atrPrev && bbPrev.lower > smaPrev - kcMult * atrPrev
    const fired = !squeezeOnNow && squeezeOnPrev

    // Momentum: linreg of (close − midline) over last `period` bars, where
    // midline = avg of (highestHigh+lowestLow)/2 and SMA(close).
    const momSeries: number[] = []
    for(let i = period - 1; i < candles.length; i++) {
        let maxH = -Infinity
        let minL =  Infinity
        let sumC = 0
        for(let j = i - period + 1; j <= i; j++) {
            const candle = candles.at(j)
            if(candle === undefined) continue
            if(candle.high > maxH) maxH = candle.high
            if(candle.low  < minL) minL = candle.low
            sumC += candle.close
        }
        const mid = ((maxH + minL) / 2 + sumC / period) / 2
        const candleAt = candles.at(i)
        if(candleAt === undefined) continue
        momSeries.push(candleAt.close - mid)
    }
    if(momSeries.length < period)
        return { name: 'TTMSqz', group: 'exotic', value: undefined, vote: 0 }

    const lr = momSeries.slice(-period)
    const n = lr.length
    const xbar = (n - 1) / 2
    let ybar = 0
    for(const value of lr) ybar += value
    ybar /= n
    let num = 0
    let den = 0
    for(let i = 0; i < n; i++) {
        num += (i - xbar) * ((lr[i] ?? 0) - ybar)
        den += (i - xbar) * (i - xbar)
    }
    const slope = den === 0 ? 0 : num / den
    const intercept = ybar - slope * xbar
    const momentum  = intercept + slope * (n - 1)

    let vote: IndicatorVote = 0
    if(fired && momentum > 0) vote = 1
    else if(fired && momentum < 0) vote = -1
    return { name: 'TTMSqz', group: 'exotic', value: momentum, vote }
}

// ---------- Kaufman Adaptive Moving Average (ER 10, fast 2, slow 30) -------

function kamaReading(candles: OhlcvCandle[]): IndicatorReading {
    const erPeriod = 10
    const fast = 2
    const slow = 30
    const { close } = extract(candles)
    if(close.length < erPeriod + 2)
        return { name: 'KAMA10', group: 'exotic', value: undefined, vote: 0 }

    const fastSC = 2 / (fast + 1)
    const slowSC = 2 / (slow + 1)

    const kama: number[] = new Array(close.length).fill(NaN)
    kama[erPeriod] = close[erPeriod] ?? 0

    for(let i = erPeriod + 1; i < close.length; i++) {
        const change = Math.abs((close[i] ?? 0) - (close[i - erPeriod] ?? 0))
        let volatility = 0
        for(let j = i - erPeriod + 1; j <= i; j++)
            volatility += Math.abs((close[j] ?? 0) - (close[j - 1] ?? 0))
        const er = volatility === 0 ? 0 : change / volatility
        const sc = (er * (fastSC - slowSC) + slowSC) ** 2
        const previous = kama[i - 1] ?? 0
        kama[i] = previous + sc * ((close[i] ?? 0) - previous)
    }

    const current  = kama.at(-1)
    const previous = kama.at(-2)
    const closeNow = close.at(-1)
    if(
        current === undefined || previous === undefined ||
        Number.isNaN(current) || Number.isNaN(previous) ||
        closeNow === undefined
    )
        return { name: 'KAMA10', group: 'exotic', value: undefined, vote: 0 }

    let vote: IndicatorVote = 0
    if(closeNow > current && current > previous) vote = 1
    else if(closeNow < current && current < previous) vote = -1
    return { name: 'KAMA10', group: 'exotic', value: current, vote }
}

// ---------- public API -----------------------------------------------------

export function exoticReadings(candles: OhlcvCandle[]): IndicatorReading[] {
    return [
        hurstReading(candles),
        connorsRsiReading(candles),
        choppinessIndexReading(candles),
        fisherTransformReading(candles),
        ttmSqueezeReading(candles),
        kamaReading(candles)
    ]
}
