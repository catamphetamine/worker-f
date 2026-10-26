import createWorkerStream from '../../../createWorkerStream.ts'
import createWorkerInBrowser from '../../../environment/createWorkerInBrowser.ts'

export default function createWorkerStreamInBrowser<Input, Output>(
	fnOrAlias: Parameters<typeof createWorkerStream<Input, Output>>[1]
) {
	return createWorkerStream(createWorkerInBrowser, fnOrAlias)
}