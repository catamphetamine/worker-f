import createWorkerFunction from '../../createWorkerFunction.ts'
import createWorkerInBrowser from '../../environment/createWorkerInBrowser.ts'

export default function createWorkerFunctionInBrowser<Args extends Array<unknown>, Result>(
	fnOrAlias: Parameters<typeof createWorkerFunction<Args, Result>>[1]
) {
	return createWorkerFunction(createWorkerInBrowser, fnOrAlias)
}