import { describe, expect, test } from 'bun:test'
import { aggregate, scoreToSignal } from '../../src/signals/aggregator'
import { IndicatorReading } from '../../src/types'

function maReading(name: string, vote: -1 | 0 | 1): IndicatorReading {
    return { name, group: 'ma', value: 0, vote }
}

function oscReading(name: string, vote: -1 | 0 | 1): IndicatorReading {
    return { name, group: 'oscillator', value: 0, vote }
}

function exoReading(name: string, vote: -1 | 0 | 1): IndicatorReading {
    return { name, group: 'exotic', value: 0, vote }
}

describe('scoreToSignal', () => {
    test('> 0.5 → STRONG BUY', () => {
        expect(scoreToSignal(0.6)).toBe('STRONG BUY')
        expect(scoreToSignal(1)).toBe('STRONG BUY')
    })

    test('> 0.1 and <= 0.5 → BUY', () => {
        expect(scoreToSignal(0.2)).toBe('BUY')
        expect(scoreToSignal(0.5)).toBe('BUY')
    })

    test('[-0.1, 0.1] → NEUTRAL', () => {
        expect(scoreToSignal(0)).toBe('NEUTRAL')
        expect(scoreToSignal(0.1)).toBe('NEUTRAL')
        expect(scoreToSignal(-0.1)).toBe('NEUTRAL')
    })

    test('< -0.1 and >= -0.5 → SELL', () => {
        expect(scoreToSignal(-0.2)).toBe('SELL')
        expect(scoreToSignal(-0.5)).toBe('SELL')
    })

    test('< -0.5 → STRONG SELL', () => {
        expect(scoreToSignal(-0.6)).toBe('STRONG SELL')
        expect(scoreToSignal(-1)).toBe('STRONG SELL')
    })
})

describe('aggregate', () => {
    test('all-bullish 15 MA + 11 osc → STRONG BUY, score 1', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, 1))
        ]
        const result = aggregate(readings)
        expect(result.maRating).toBe(1)
        expect(result.oscRating).toBe(1)
        expect(result.score).toBe(1)
        expect(result.signal).toBe('STRONG BUY')
    })

    test('all-bearish → STRONG SELL, score -1', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, -1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, -1))
        ]
        const result = aggregate(readings)
        expect(result.score).toBe(-1)
        expect(result.signal).toBe('STRONG SELL')
    })

    test('all-neutral → NEUTRAL, score 0', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 0)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, 0))
        ]
        const result = aggregate(readings)
        expect(result.score).toBe(0)
        expect(result.signal).toBe('NEUTRAL')
    })

    test('MA strong bullish + osc strong bearish → NEUTRAL (they cancel)', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, -1))
        ]
        const result = aggregate(readings)
        expect(result.maRating).toBe(1)
        expect(result.oscRating).toBe(-1)
        expect(result.score).toBe(0)
        expect(result.signal).toBe('NEUTRAL')
    })

    test('MA all +1, osc split half → score > 0.1 → BUY tier', () => {
        const oscVotes: IndicatorReading[] = []
        for(let i = 0; i < 11; i++) oscVotes.push(oscReading(`OSC${i}`, i < 6 ? 1 : 0))
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...oscVotes
        ]
        const result = aggregate(readings)
        // maRating=1, oscRating=6/11 ≈ 0.545 → score ≈ 0.77 → STRONG BUY
        expect(result.signal).toBe('STRONG BUY')
    })

    test('empty readings list → NEUTRAL, score 0', () => {
        const result = aggregate([])
        expect(result.score).toBe(0)
        expect(result.signal).toBe('NEUTRAL')
        expect(result.exoticRating).toBeNull()
    })

    test('no exotic readings → exoticRating is null and score ignores the group', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, 1))
        ]
        const result = aggregate(readings)
        expect(result.exoticRating).toBeNull()
        expect(result.score).toBe(1)
    })

    test('exotic group included → three-way average, exoticRating populated', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, 1)),
            ...Array.from({ length: 6 },  (_, idx) => exoReading(`EXO${idx}`, -1))
        ]
        const result = aggregate(readings)
        expect(result.maRating).toBe(1)
        expect(result.oscRating).toBe(1)
        expect(result.exoticRating).toBe(-1)
        // (1 + 1 + -1) / 3 ≈ 0.333 → BUY tier
        expect(result.score).toBeCloseTo(1 / 3, 5)
        expect(result.signal).toBe('BUY')
    })

    test('exotic all +1 nudges a barely-buy into strong territory', () => {
        const readings: IndicatorReading[] = [
            ...Array.from({ length: 15 }, (_, idx) => maReading(`MA${idx}`, 1)),
            ...Array.from({ length: 11 }, (_, idx) => oscReading(`OSC${idx}`, 0)),
            ...Array.from({ length: 6 },  (_, idx) => exoReading(`EXO${idx}`, 1))
        ]
        const result = aggregate(readings)
        // (1 + 0 + 1) / 3 ≈ 0.667 → STRONG BUY
        expect(result.score).toBeCloseTo(2 / 3, 5)
        expect(result.signal).toBe('STRONG BUY')
    })
})
