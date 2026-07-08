import createStreamingWorkerFunction from '../../../createStreamingWorkerFunction.ts'
import createWorkerInBrowser from '../../../environment/createWorkerInBrowser.ts'

export default function createStreamingWorkerFunctionInBrowser<Input, Output>(
	fnOrAlias: Parameters<typeof createStreamingWorkerFunction<Input, Output>>[1]
) {
	return createStreamingWorkerFunction(createWorkerInBrowser, fnOrAlias)
}