import { describe, expect, test } from 'bun:test'
import { getValueFromArgv, isArgv, getPositionalArg } from '../../src/lib/argv'

describe('getValueFromArgv', () => {
    test('returns value for --key=value', () => {
        expect(getValueFromArgv('--pair', ['--pair=BTCUSDT'])).toBe('BTCUSDT')
    })

    test('returns null when absent', () => {
        expect(getValueFromArgv('--pair', ['--other=val'])).toBeNull()
    })

    test('does not match partial prefix of another flag', () => {
        expect(getValueFromArgv('--fee', ['--feedback=1'])).toBeNull()
    })

    test('handles empty string value', () => {
        expect(getValueFromArgv('--pair', ['--pair='])).toBe('')
    })
})

describe('isArgv', () => {
    test('detects bare flag', () => {
        expect(isArgv('--inverted', ['--inverted'])).toBe(true)
    })

    test('detects --flag=true form', () => {
        expect(isArgv('--inverted', ['--inverted=true'])).toBe(true)
    })

    test('returns false when flag missing', () => {
        expect(isArgv('--inverted', ['--pair=BTC'])).toBe(false)
    })

    test('does not treat --flag=false as set', () => {
        expect(isArgv('--inverted', ['--inverted=false'])).toBe(false)
    })
})

describe('getPositionalArg', () => {
    test('returns first positional after command', () => {
        const argv = ['bun', 'src/index.ts', 'simulate', 'BTCUSDT', '--interval=1h']
        expect(getPositionalArg(argv, 2)).toBe('BTCUSDT')
    })

    test('returns null if next token is a flag', () => {
        const argv = ['bun', 'src/index.ts', 'simulate', '--pair=BTCUSDT']
        expect(getPositionalArg(argv, 2)).toBeNull()
    })

    test('returns null if no token after command', () => {
        const argv = ['bun', 'src/index.ts', 'simulate']
        expect(getPositionalArg(argv, 2)).toBeNull()
    })

    test('works with a path-like positional', () => {
        const argv = ['bun', 'src/index.ts', 'analyze', './output/file.ndjson', '--inverted']
        expect(getPositionalArg(argv, 2)).toBe('./output/file.ndjson')
    })
})
