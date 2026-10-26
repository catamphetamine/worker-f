import createWorkerStream from '../../../createWorkerStream.ts'
import createWorkerInNode from '../../../environment/createWorkerInNode.ts'

export default function createWorkerStreamInNode<Input, Output>(
	fnOrAlias: Parameters<typeof createWorkerStream<Input, Output>>[1]
) {
	return createWorkerStream(createWorkerInNode, fnOrAlias)
}