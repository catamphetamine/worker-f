import type { CreateWorkerInEnvironment } from './createWorker.ts'
import createWorkerFunction_, { type WorkerFunctionBase } from './createWorkerFunction_.ts'

type InputHandler<Input> = (input: Input) => unknown
export type Send<Output> = (output: Output) => void
export type StreamingFn<Input, Output> =
	(send: Send<Output>) => InputHandler<Input>

export default function createStreamingWorkerFunction<Input, Output>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	fnOrAlias: StreamingFn<Input, Output> | string
): StreamingWorkerFunction<Input, Output> {
	// When the worker function streams output data, this listener Listens to the output in the main thread.
	let streamingOutputListener: OutputListener<Output> | undefined = undefined
	// When the worker function streams output data, this listener Listens to any errors that happen in the worker thread.
	let streamingErrorListener: ErrorListener | undefined = undefined

	// Declare a worker function. It will be returned from this function.
	const createMethods = (
		start: () => void,
		stop: () => void,
		started: boolean,
		stopped: boolean,
		sendToWorker: (inputArgs: [Input]) => void,
		mustHaveStarted: () => void,
		mustNotHaveStarted: () => void,
		mustNotHaveStopped: () => void
	) => ({
		// Defines the listener of the responses from the worker.
		onOutput(listener: OutputListener<Output>) {
			mustNotHaveStopped()
			mustNotHaveStarted()
			if (streamingOutputListener) {
				throw new Error('Already listening')
			}
			streamingOutputListener = listener
			// isStreamingFn = true
		},
		// Defines the listener of the responses from the worker.
		onError(listener: ErrorListener) {
			mustNotHaveStopped()
			mustNotHaveStarted()
			if (streamingErrorListener) {
				throw new Error('Already set up')
			}
			streamingErrorListener = listener
			// isStreamingFn = true
		},
		// Pushes input data to a listenable function.
		send(input: Input) {
			mustNotHaveStopped()
			mustHaveStarted()
			sendToWorker([input])
		}
	})

	// This function will be executed in the worker thread.
	// It will be stringified and injected in the worker source code.
	// Therefore, it should be a "self-contained" function,
	// i.e. it shouldn't reference anything outside of its body.
	const createInputHandler = (
		fn: StreamingFn<Input, Output>,
		send: Send<Output>
	) => {
		const inputHandler = fn(send)
		return ([input]: [Input]) => {
			inputHandler(input)
		}
	}

	// This function will be executed in the main thread.
	// Currently, we are in the main thread.
	const handleError = (error: unknown) => {
		if (streamingErrorListener) {
			streamingErrorListener(error)
		} else {
			throw error
		}
	}

	// This function will be executed in the main thread.
	// Currently, we are in the main thread.
	const handleOutput = (output: Output) => {
		if (streamingOutputListener) {
			streamingOutputListener(output)
		} else {
			console.warn('[worker-f] Response missed', output)
		}
	}

	return createWorkerFunction_(
		createWorkerInEnvironment,
		fnOrAlias,
		createMethods,
		createInputHandler,
		handleError,
		handleOutput
	)
}

type OutputListener<Output> = (output: Output) => void

type ErrorListener = (error: unknown) => void

export interface StreamingWorkerFunction<Input, Output> extends WorkerFunctionBase<[Input], Output> {
	onOutput(
		listener: OutputListener<Output>
	): void;

	onError(listener: ErrorListener): void;

	send(data: Input): void;
}