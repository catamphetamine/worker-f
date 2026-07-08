import type { GetDependencies, UniversalWorker, CreateWorkerInEnvironment } from './createWorkerFunction.common.d.ts'
import createWorker from './createWorker.ts'

type SyncFn<Args extends Array<unknown>, Result> = (...args: Args) => Result
type AsyncFn<Args extends Array<unknown>, Result> = (...args: Args) => Promise<Result>

export type Fn<Args extends Array<unknown>, Result> =
	| SyncFn<Args, Result>
	| AsyncFn<Args, Result>

export default function createWorkerFunction<Args extends Array<unknown>, Result>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	fnOrAlias: Fn<Args, Result> | string
): WorkerFunction<Args, Result> {
	// `transferList` for external dependencies.
	const dependenciesTransferList: Transferable[] | undefined = undefined

	// `transferList` for the arguments of the function.
	let inputTransferList: (...args: Args) => Transferable[] = () => []

	// `transferList` for the result of the function.
	let outputTransferList: (result: Result) => Transferable[] = () => []

	// When the worker function returns a monolithic response,
	// use `resolveCall()`/`rejectCall()` functions to report the response to the main thread.
	// These functions will `resolve` or `reject` the `Promise` returned from `.call()` or `.callOnce()`.
	let resolveCall: ((result: Result) => void) | undefined = undefined
	let rejectCall: ((error: unknown) => void) | undefined = undefined

	// "Started" and "stopped" flags.
	let started = false
	let stopped = false

	// (optional) Caching.
	let alias: string | undefined = undefined

	const getFromCache = <Args extends Array<unknown>, Result>(
		cacheKey: string
	): CacheValue<Args, Result> => {
		return CACHE[cacheKey]
	}

	const setInCache = (cacheKey: string, value: CacheValue<Args, Result>) => {
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
		? getFromCache(fnOrAlias) && getFromCache<Args, Result>(fnOrAlias).fn
		: fnOrAlias

	// Validate the function.
	if (typeof fn !== 'function') {
		throw new TypeError('Function not provided')
	}

	// "Closure" functions that return any external dependencies.
	const getDependenciesFunctions: GetDependencies[] = []

	let worker: UniversalWorker

	// Declare a worker function. It will be returned from this function.
	const workerFn: WorkerFunction<Args, Result> = {
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
		// Calls the function. Could be used multiple times.
		call(...args: Args) {
			mustNotHaveStopped()
			mustHaveStarted()
			if (resolveCall || rejectCall) {
				throw new Error('Previous call not finished')
			}
			// isStreamingFn = false
			return new Promise((resolve, reject) => {
				resolveCall = resolve
				rejectCall = reject
				worker.push(args, inputTransferList(...args))
			})
		},
		// Calls the function once.
		callOnce(...args: Args) {
			this.start()
			return this.call(...args).finally(this.stop)
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
	const setOtherInCache = (value: CacheValue<Args, Result>['other']) => {
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
			send_: (response: Result, transferList?: Transferable[]) => void
		) => {
			const respond = (result: Result) => {
				send_(result, outputTransferList(result))
			}
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
					result.then(respond)
				} else {
					respond(result)
				}
			}
		},
		// This function will be executed in the main thread.
		// Currently, we are in the main thread.
		(error: unknown) => {
			if (rejectCall) {
				rejectCall(error)
				resolveCall = undefined
				rejectCall = undefined
			} else {
				throw new Error('`reject` callback not found')
			}
		},
		// This function will be executed in the main thread.
		// Currently, we are in the main thread.
		(result:  Result) => {
			if (resolveCall) {
				resolveCall(result)
				resolveCall = undefined
				rejectCall = undefined
			} else {
				throw new Error('`resolve` callback not found')
			}
		},
		// Caching.
		getOtherFromCache,
		setOtherInCache
	)

	return workerFn
}

const CACHE: Record<string, CacheValue<any[], any>> = {}

interface CacheValue<Args extends Array<unknown>, Result> {
	fn?: Fn<Args, Result>;
	other?: any;
}

export interface WorkerFunction<
	Args extends Array<unknown>,
	Result
> {
	call(...args: Args): Promise<Result>;
	callOnce(...args: Args): Promise<Result>;

	addDependencies(getDependencies: GetDependencies): void;

	inputTransferList(
		fn: (...args: Args) => Transferable[]
	): void;

	outputTransferList(
		fn: (result: Result) => Transferable[]
	): void;

	alias(alias: string): void;
	start(): void;
	stop(): void;
}