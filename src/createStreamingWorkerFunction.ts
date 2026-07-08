import type { GetDependencies, UniversalWorker, CreateWorkerInEnvironment } from './createWorkerFunction.common.d.ts'
import createWorker from './createWorker.ts'

type InputHandler<Input> = (input: Input) => unknown
export type Send<Output> = (output: Output) => void
export type StreamingFn<Input, Output> =
	(send: Send<Output>) => InputHandler<Input>

export default function createStreamingWorkerFunction<Input, Output>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	fnOrAlias: StreamingFn<Input, Output> | string
): StreamingWorkerFunction<Input, Output> {
	// `transferList` for external dependencies.
	const dependenciesTransferList: Transferable[] | undefined = undefined

	// `transferList` for the arguments of the function.
	let inputTransferList: (...args: any[]) => Transferable[] = () => []

	// `transferList` for the result of the function.
	let outputTransferList: (...args: any[]) => Transferable[] = () => []

	// When the worker function streams output data, this listener Listens to the output in the main thread.
	let streamingOutputListener: OutputListener<Output> | undefined = undefined
	// When the worker function streams output data, this listener Listens to any errors that happen in the worker thread.
	let streamingErrorListener: ErrorListener | undefined = undefined

	// "Started" and "stopped" flags.
	let started = false
	let stopped = false

	// (optional) Caching.
	let alias: string | undefined = undefined

	const getFromCache = <Input, Output>(
		cacheKey: string
	): CacheValue<Input, Output> => {
		return CACHE[cacheKey]
	}

	const setInCache = (cacheKey: string, value: CacheValue<Input, Output>) => {
		CACHE[cacheKey] = value
	}

	const mustHaveStarted = () => {
		if (!started) {
			throw new Error('Not started')
		}
	}

	const mustNotHaveStarted = () => {
		if (started) {
			throw new Error('Already started')
		}
	}

	const mustNotHaveStopped = () => {
		if (stopped) {
			throw new Error('Already stopped')
		}
	}

	const argumentMustBeFunction = (arg: any) => {
		if (typeof arg !== 'function') {
			throw new TypeError('Argument must be a function')
		}
	}

	// Get the function from cache if alias is passed instead of a function body.
	const fn = typeof fnOrAlias === 'string'
		? getFromCache(fnOrAlias) && getFromCache<Input, Output>(fnOrAlias).fn
		: fnOrAlias

	// Validate the function.
	if (typeof fn !== 'function') {
		throw new TypeError('Function not provided')
	}

	// "Closure" functions that return any external dependencies.
	const getDependenciesFunctions: GetDependencies[] = []

	let worker: UniversalWorker

	// Declare a worker function. It will be returned from this function.
	const workerFn: StreamingWorkerFunction<Input, Output> = {
		/**
		 * Adds external dependencies.
		 * These dependencies must not change after the function is started.
		 *
		 * @param {function} getDependencies — A "closure" function that returns an array of dependencies — global variables or functions — that will be used in this worker. If some dependencies get overlooked, the worker will throw "[name] is not defined".
		 */
		addDependencies(getDependencies: GetDependencies) {
			mustNotHaveStopped()
			mustNotHaveStarted()
			// Non-TypeScript code argument validation.
			argumentMustBeFunction(getDependencies)
			getDependenciesFunctions.push(getDependencies)
		},
		// `transferList` for the arguments of the function.
		inputTransferList: (fn: typeof inputTransferList) => {
			mustNotHaveStopped()
			mustNotHaveStarted()
			// Non-TypeScript code argument validation.
			argumentMustBeFunction(fn)
			inputTransferList = fn
		},
		// `transferList` for the result of the function.
		outputTransferList: (fn: typeof outputTransferList) => {
			mustNotHaveStopped()
			mustNotHaveStarted()
			// Non-TypeScript code argument validation.
			argumentMustBeFunction(fn)
			outputTransferList = fn
		},
		// (optional) Enables caching.
		alias(alias_: string) {
			mustNotHaveStopped()
			mustNotHaveStarted()
			alias = alias_
			setInCache(alias, { fn })
		},
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
		send(data: Input) {
			mustNotHaveStopped()
			mustHaveStarted()
			worker.push(data, inputTransferList(data))
		},
		// Starts the worker.
		start() {
			mustNotHaveStopped()
			mustNotHaveStarted()
			started = true
			worker.start(getDependenciesFunctions, dependenciesTransferList)
		},
		// Stops the worker.
		// Calling this function multiple times is normal and it won't produce any errors.
		stop() {
			stopped = true
			worker.stop()
			streamingOutputListener = undefined
			streamingErrorListener = undefined
		}
	}

	// These dependencies must not change after the function is started.
	workerFn.addDependencies(() => [
		fn,
		outputTransferList
	])

	// Cache accessors for use in `createWorker`.
	const getOtherFromCache = () => {
		if (alias) {
			const properties = getFromCache(alias)
			if (properties) {
				return properties.other
			}
		}
	}
	const setOtherInCache = (value: CacheValue<Input, Output>['other']) => {
		if (alias) {
			setInCache(alias, {
				...getFromCache(alias),
				other: value
			})
		}
	}

	worker = createWorker(
		// Creates a worker in a specific environment.
		createWorkerInEnvironment,
		// This function will be executed in the worker thread.
		// It will be stringified and injected in the worker source code.
		(
			send_: (output: Output, transferList?: Transferable[]) => void
		) => {
			const send = (response: Output) => {
				send_(response, outputTransferList(response))
			}
			return fn(send)
		},
		// This function will be executed in the main thread.
		// Currently, we are in the main thread.
		(error: unknown) => {
			if (streamingErrorListener) {
				streamingErrorListener(error)
			} else {
				throw error
			}
		},
		// This function will be executed in the main thread.
		// Currently, we are in the main thread.
		(output: Output) => {
			if (streamingOutputListener) {
				streamingOutputListener(output)
			} else {
				console.warn('[worker-f] Response missed', output)
			}
		},
		// Caching.
		getOtherFromCache,
		setOtherInCache
	)

	return workerFn
}

const CACHE: Record<string, CacheValue<any, any>> = {}

interface CacheValue<Input, Output> {
	fn?: StreamingFn<Input, Output>;
	other?: any;
}

type OutputListener<Output> = (output: Output) => void

type ErrorListener = (error: unknown) => void

export interface StreamingWorkerFunction<Input, Output> {
	onOutput(
		listener: OutputListener<Output>
	): void;

	onError(listener: ErrorListener): void;

	send(data: Input): void;

	addDependencies(getDependencies: GetDependencies): void;

	inputTransferList(
		fn: (input: Input) => Transferable[]
	): void;

	outputTransferList(
		fn: (output: Output) => Transferable[]
	): void;

	alias(alias: string): void;
	start(): void;
	stop(): void;
}