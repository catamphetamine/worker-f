import type { CreateWorkerInEnvironment } from './createWorker.ts'
import createWorkerFunctionOrStream, { type WorkerFunctionOrStream } from './createWorkerFunctionOrStream.ts'

type InputHandler<Input> = (input: Input) => unknown

export type Emit<Output> = (output: Output) => void

// The legacy name for `Emit` was `Send`.
/**
 * @deprecated Use `Emit` type instead.
 */
export type Send<Output> = Emit<Output>

export type StreamingFn<Input, Output> =
	(emit: Emit<Output>) => InputHandler<Input>

export default function createWorkerStream<Input, Output>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	fnOrAlias: StreamingFn<Input, Output> | string
): WorkerStream<Input, Output> {
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
	) => {
		/**
		 * Pushes input data to the worker.
		 * @param input
		 */
		const push = (input: Input) => {
			mustNotHaveStopped()
			mustHaveStarted()
			sendToWorker([input])
		}

		return {
			// Defines the listener of the responses from the worker.
			onOutput(listener: OutputListener<Output>) {
				mustNotHaveStopped()
				mustNotHaveStarted()
				// When called multiple times, it'll just overwrite the listener.
				// This behavior is convenient when a worker function gets reused.
				// if (streamingOutputListener) {
				// 	throw new Error('Already listening')
				// }
				streamingOutputListener = listener
				// isStreamingFn = true
			},
			// Defines the listener of the responses from the worker.
			onError(listener: ErrorListener) {
				mustNotHaveStopped()
				mustNotHaveStarted()
				// When called multiple times, it'll just overwrite the listener.
				// This behavior is convenient when a worker function gets reused.
				// if (streamingErrorListener) {
				// 	throw new Error('Already set up')
				// }
				streamingErrorListener = listener
				// isStreamingFn = true
			},
			// Pushes input data to the worker.
			push,
			/**
			 * Pushes input data to the worker.
			 * @deprecated Use `push()` method instead.
			 */
			send: push
		}
	}

	// This function will be executed in the worker thread.
	// It will be stringified and injected in the worker source code.
	// Therefore, it should be a "self-contained" function,
	// i.e. it shouldn't reference anything outside of its body.
	const createInputHandler = (
		fn: StreamingFn<Input, Output>,
		emit: Emit<Output>
	) => {
		const inputHandler = fn(emit)
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
			try {
				streamingOutputListener(output)
			} catch (error) {
				handleError(error)
			}
		} else {
			console.warn('[worker-f] Worker output missed', output)
		}
	}

	return createWorkerFunctionOrStream(
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

export interface WorkerStream<Input, Output> extends WorkerFunctionOrStream<[Input], Output> {
	onOutput(
		listener: OutputListener<Output>
	): void;

	onError(listener: ErrorListener): void;

	push(data: Input): void;

	/**
	 * @deprecated Use `push()` method instead.
	 */
	send(data: Input): void;
}

// The legacy name for `WorkerStream` was `StreamingWorkerFunction`.
/**
 * @deprecated Use `WorkerStream` type instead.
 */
export interface StreamingWorkerFunction<Input, Output> extends WorkerStream<Input, Output> {}