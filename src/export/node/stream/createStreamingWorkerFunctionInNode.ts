import createStreamingWorkerFunction from '../../../createStreamingWorkerFunction.ts'
import createWorkerInNode from '../../../environment/createWorkerInNode.ts'

export default function createStreamingWorkerFunctionInNode<Input, Output>(
	fnOrAlias: Parameters<typeof createStreamingWorkerFunction<Input, Output>>[1]
) {
	return createStreamingWorkerFunction(createWorkerInNode, fnOrAlias)
}