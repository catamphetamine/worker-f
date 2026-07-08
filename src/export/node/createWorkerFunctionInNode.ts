import createWorkerFunction from '../../createWorkerFunction.ts'
import createWorkerInNode from '../../environment/createWorkerInNode.ts'

export default function createWorkerFunctionInNode<Args extends Array<unknown>, Result>(
	fnOrAlias: Parameters<typeof createWorkerFunction<Args, Result>>[1]
) {
	return createWorkerFunction(createWorkerInNode, fnOrAlias)
}