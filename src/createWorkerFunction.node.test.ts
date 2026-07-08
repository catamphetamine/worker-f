import runTests from './createWorkerFunctionTests.ts'
import createWorkerInNode from './environment/createWorkerInNode.ts'

runTests(createWorkerInNode)