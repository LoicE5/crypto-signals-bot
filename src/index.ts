import { validCommands } from './constants'
import { runSimulate } from './commands/simulate'
import { runWrite } from './commands/write'
import { runAnalyze } from './commands/analyze'
import { runCli } from './cli'

const commandArg = process.argv.at(2)
const commandIndex = 2

if(!commandArg) {
    await runCli()
} else {
    if(!validCommands.has(commandArg)) {
        console.error(`Invalid command "${commandArg}". Expected one of: ${[...validCommands].join(', ')}`)
        process.exit(1)
    }

    process.on('SIGINT', () => process.exit(0))

    if(commandArg === 'analyze')
        await runAnalyze(process.argv, commandIndex)
    else if(commandArg === 'simulate')
        await runSimulate(process.argv, commandIndex)
    else if(commandArg === 'write')
        await runWrite(process.argv, commandIndex)
}
