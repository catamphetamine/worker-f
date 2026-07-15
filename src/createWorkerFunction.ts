import type { CreateWorkerInEnvironment } from './createWorker.ts'
import createWorkerFunction_, { type WorkerFunctionBase } from './createWorkerFunction_.ts'

type SyncFn<Args extends Array<unknown>, Result> = (...args: Args) => Result
type AsyncFn<Args extends Array<unknown>, Result> = (...args: Args) => Promise<Result>

export type Fn<Args extends Array<unknown>, Result> =
	| SyncFn<Args, Result>
	| AsyncFn<Args, Result>

export default function createWorkerFunction<Args extends Array<unknown>, Result>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	fnOrAlias: Fn<Args, Result> | string
): WorkerFunction<Args, Result> {
	// When the worker function returns a monolithic response,
	// use `resolveCall()`/`rejectCall()` functions to report the response to the main thread.
	// These functions will `resolve` or `reject` the `Promise` returned from `.call()` or `.callOnce()`.
	let resolveCall: ((result: Result) => void) | undefined = undefined
	let rejectCall: ((error: unknown) => void) | undefined = undefined

	const createMethods = (
		start: () => void,
		stop: () => void,
		started: boolean,
		stopped: boolean,
		sendToWorker: (inputArgs: Args) => void,
		mustHaveStarted: () => void,
		mustNotHaveStarted: () => void,
		mustNotHaveStopped: () => void
	) => ({
		// Calls the function. Could be used multiple times.
		call(...args: Args): Promise<Result> {
			mustNotHaveStopped()
			mustHaveStarted()
			if (resolveCall || rejectCall) {
				throw new Error('Previous call not finished')
			}
			// isStreamingFn = false
			return new Promise((resolve, reject) => {
				resolveCall = resolve
				rejectCall = reject
				sendToWorker(args)
			})
		},
		// Calls the function once.
		callOnce(...args: Args) {
			start()
			return this.call(...args).finally(stop)
		}
	})

	// This function will be executed in the worker thread.
	// It will be stringified and injected in the worker source code.
	// Therefore, it should be a "self-contained" function,
	// i.e. it shouldn't reference anything outside of its body.
	const createInputHandler = (
		fn: Fn<Args, Result>,
		send: (output: Result) => void
	) => {
		const isPromise = <Value>(anything: unknown): anything is Promise<Value> => {
			return (
				anything !== null &&
				typeof anything === 'object' &&
				typeof (anything as Promise<unknown>).then === 'function'
			)
		}
		return (args: Args) => {
			const result = fn(...args)
			if (isPromise(result)) {
				result.then(send)
			} else {
				send(result)
			}
		}
	}

	// This function will be executed in the main thread.
	// Currently, we are in the main thread.
	const handleError = (error: unknown) => {
		if (rejectCall) {
			rejectCall(error)
			resolveCall = undefined
			rejectCall = undefined
		} else {
			throw new Error('`reject` callback not found')
		}
	}

	// This function will be executed in the main thread.
	// Currently, we are in the main thread.
	const handleOutput = (output: Result) => {
		if (resolveCall) {
			resolveCall(output)
			resolveCall = undefined
			rejectCall = undefined
		} else {
			throw new Error('`resolve` callback not found')
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

export interface WorkerFunction<
	Args extends Array<unknown>,
	Result
> extends WorkerFunctionBase<Args, Result> {
	call(...args: Args): Promise<Result>;
	callOnce(...args: Args): Promise<Result>;
}