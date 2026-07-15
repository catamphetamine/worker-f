import createWorker, {
	type GetDependencies,
	type UniversalWorker,
	type CreateWorkerInEnvironment,
	type SendOutput,
	type InputSentTimestampAndInputReceivedTimestampAndOutputSentTimestampAndOutput
} from './createWorker.ts'

export default function createWorkerFunction_<
	Fn,
	InputArgs extends Array<unknown>,
	Output,
	AdditionalMethods
>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,

	fnOrAlias: Fn | string,

	createMethods: (
		start: () => void,
		stop: () => void,
		started: boolean,
		stopped: boolean,
		sendToWorker: (inputArgs: InputArgs) => void,
		mustHaveStarted: () => void,
		mustNotHaveStarted: () => void,
		mustNotHaveStopped: () => void
	) => AdditionalMethods,

	createInputHandler: (
		fn: Fn,
		send: (output: Output) => void
	) => (args: InputArgs) => void,

	handleError: (error: unknown) => void,

	handleOutput: (output: Output) => void
): WorkerFunctionBase<InputArgs, Output> & AdditionalMethods {
	// "Started" and "stopped" flags.
	let started = false
	let stopped = false

	// "Closure" functions that return any external dependencies.
	let getDependenciesFunctions: GetDependencies[] = []

	// `transferList` for external dependencies.
	const dependenciesTransferList: Transferable[] | undefined = undefined

	// `transferList` for the arguments of the function.
	type GetInputTransferList = (...args: InputArgs) => Transferable[]
	let inputTransferList: GetInputTransferList = () => []

	// `transferList` for the result of the function.
	type GetOutputTransferList = (result: Output) => Transferable[]
	let outputTransferList: GetOutputTransferList = () => []

	// (optional) Caching.
	let alias: string | undefined = undefined
	let cacheValue: CacheValue<Fn, InputArgs, Output> | undefined = undefined

	const getFromCache = <Fn>(
		cacheKey: string
	): CacheValue<Fn, InputArgs, Output> => {
		return CACHE[cacheKey]
	}

	const setInCache = (cacheKey: string, value: CacheValue<Fn, InputArgs, Output>) => {
		CACHE[cacheKey] = value
	}

	const mustHaveStarted = () => {
		if (!started) {
			throw new Error('Not started')
		}
	}

	const mustNotHaveStarted = () => {
		if (started) {
			throw new Error('Was started')
		}
	}

	const mustNotHaveStopped = () => {
		if (stopped) {
			throw new Error('Was stopped')
		}
	}

	const mustNotHaveAlias = () => {
		if (alias) {
			throw new Error('Has alias')
		}
	}

	const argumentMustBeFunction = (arg: any) => {
		if (typeof arg !== 'function') {
			throw new TypeError('Argument must be a function')
		}
	}

	let fn: Fn
	// See whether the argument is an alias string or a function.
	if (typeof fnOrAlias === 'string') {
		alias = fnOrAlias
		cacheValue = getFromCache(alias)
		// The additional `if` conditions were added just to work around
		// TypeScript compiler error message.
		if (!cacheValue || !cacheValue.$) {
			throw new Error('Not found')
		}
		// Restore the functions from cache.
		fn = cacheValue.$[0]
		getDependenciesFunctions = cacheValue.$[1]
		inputTransferList = cacheValue.$[2]
		outputTransferList = cacheValue.$[3]
		// The "expect error" guard below checks that a developer of this package
		// didn't "forget" to restore any other stuff from cache.
		// @ts-expect-error: All elements of the `cacheValue` array should be restored above. In case of adding new stuff in `cachedValue`, increment the index below accordingly.
		cacheValue.$[4]
	} else {
		fn = fnOrAlias
	}

	// Validate the function.
	argumentMustBeFunction(fn)

	let worker: UniversalWorker

	/**
	 * Adds external dependencies.
	 * These dependencies must not change after the function is started.
	 *
	 * @param {function} getDependencies — A "closure" function that returns an array of dependencies — global variables or functions — that will be used in this worker. If some dependencies get overlooked, the worker will throw "[name] is not defined".
	 */
	const addDependencies_ = (getDependencies: GetDependencies) => {
		mustNotHaveStopped()
		mustNotHaveStarted()
		// Non-TypeScript code argument validation.
		argumentMustBeFunction(getDependencies)
		getDependenciesFunctions.push(getDependencies)
	}

	// Starts the worker.
	const start = () => {
		mustNotHaveStopped()
		mustNotHaveStarted()

		// The initial dependencies are declared this way because it's a "safety measure"
		// against a developer of this package "forgetting" to add an essential initial dependency
		// to the list of cached values when using an alias feature.
		// This declaration establishes a semantic rule that any intiial dependency listed here,
		// except for `createInputHandler`, should be included in the cached values.
		type GetInitialDependencies = () => [
			// `fn`
			Required<CacheValue<Fn, InputArgs, Output>>['$'][0],
			// `outputTransferList`
			Required<CacheValue<Fn, InputArgs, Output>>['$'][3],
			// `createInputHandler`
			typeof createInputHandler
		]

		// These dependencies can change before the function is started, but not after that.
		//
		// `createInputHandler()` is not supplied by the user, and it stays the same.
		// It's the same between any two "streaming" or non-"streaming" worker functions.
		//
		const getInitialDependencies: GetInitialDependencies = () => [
			fn,
			outputTransferList,
			createInputHandler
		]

		addDependencies_(getInitialDependencies)

		started = true

		worker.start(getDependenciesFunctions, dependenciesTransferList)
	}

	// Stops the worker.
	// Calling this function multiple times is normal and it won't produce any errors.
	const stop = () => {
		stopped = true
		worker.stop()
	}

	// Sends input data to the worker.
	const sendToWorker = (inputArgs: InputArgs) => {
		worker.ingest([Date.now(), inputArgs], inputTransferList(...inputArgs))
	}

	// These two variables are defined here just to work around
	// TypeScript compiler error message.
	let inputLatency: number | undefined
	let outputLatency: number | undefined

	// Declare a worker function. It will be returned from this function.
	const workerFn = {
		inputLatency,
		outputLatency,
		/**
		 * Adds external dependencies.
		 * These dependencies must not change after the function is started.
		 *
		 * @param {function} getDependencies — A "closure" function that returns an array of dependencies — global variables or functions — that will be used in this worker. If some dependencies get overlooked, the worker will throw "[name] is not defined".
		 */
		addDependencies(getDependencies: GetDependencies) {
			mustNotHaveAlias()
			addDependencies_(getDependencies)
		},
		// `transferList` for the arguments of the function.
		inputTransferList: (fn: typeof inputTransferList) => {
			mustNotHaveStopped()
			mustNotHaveStarted()
			mustNotHaveAlias()
			// Non-TypeScript code argument validation.
			argumentMustBeFunction(fn)
			inputTransferList = fn
		},
		// `transferList` for the result of the function.
		outputTransferList: (fn: typeof outputTransferList) => {
			mustNotHaveStopped()
			mustNotHaveStarted()
			mustNotHaveAlias()
			// Non-TypeScript code argument validation.
			argumentMustBeFunction(fn)
			outputTransferList = fn
		},
		// (optional) Enables caching.
		alias(alias_: string) {
			mustNotHaveStopped()
			mustNotHaveStarted()
			mustNotHaveAlias()
			alias = alias_
			setInCache(alias, {
				$: [fn, getDependenciesFunctions, inputTransferList, outputTransferList]
			})
		},
		start,
		stop,
		...createMethods(
			start,
			stop,
			started,
			stopped,
			sendToWorker,
			mustHaveStarted,
			mustNotHaveStarted,
			mustNotHaveStopped
		)
	}

	// Cache accessors for use in `createWorker`.
	const getOtherFromCache = () => {
		if (alias) {
			const properties = getFromCache(alias)
			if (properties) {
				return properties.other
			}
		}
	}
	const setOtherInCache = (value: CacheValue<Fn, InputArgs, Output>['other']) => {
		if (alias) {
			setInCache(alias, {
				...getFromCache(alias),
				other: value
			})
		}
	}

	worker = createWorker(
		// Creates a worker in a specific environment such as a web browser or Node.js.
		createWorkerInEnvironment,
		// This function will be executed in the worker thread.
		// It will be stringified and injected in the worker source code.
		// It must create an input handler function.
		(
			// This function sends output from the worker thread to the main thread.
			sendOutput_: SendOutput<Output>
		) => {
			let inputSentTimestamp = 0
			let inputReceivedTimestamp = 0
			const sendOutput = (output: Output) => {
				sendOutput_([inputSentTimestamp, inputReceivedTimestamp, Date.now(), output], outputTransferList(output))
			}
			const inputHandler = createInputHandler(fn, sendOutput)
			return ([inputSentAt, input]: [number, InputArgs]) => {
				inputSentTimestamp = inputSentAt
				inputReceivedTimestamp = Date.now()
				return inputHandler(input)
			}
		},
		// This function will be executed in the main thread
		// when an error is received from the worker.
		// Currently, we are in the main thread.
		(error: unknown) => {
			if (!stopped) {
				handleError(error)
			}
		},
		// This function will be executed in the main thread
		// when output is received from the worker.
		// Currently, we are in the main thread.
		([inputSentTimestamp, inputReceivedTimestamp, outputTimestamp, output]: InputSentTimestampAndInputReceivedTimestampAndOutputSentTimestampAndOutput<Output>) => {
			if (!stopped) {
				workerFn.inputLatency = inputReceivedTimestamp - inputSentTimestamp
				workerFn.outputLatency = Date.now() - outputTimestamp
				handleOutput(output)
			}
		},
		// Caching.
		getOtherFromCache,
		setOtherInCache
	)

	return workerFn
}

const CACHE: Record<string, CacheValue<any, any, any>> = {}

interface CacheValue<Fn, InputArgs extends Array<unknown>, Output> {
	$?: [
		Fn,
		GetDependencies[],
		((...inputArgs: InputArgs) => Transferable[]),
		((output: Output) => Transferable[])
	];
	other?: any;
}

export interface WorkerFunctionBase<InputArgs extends Array<unknown>, Output> {
	addDependencies(getDependencies: GetDependencies): void;

	inputTransferList(
		fn: (...args: InputArgs) => Transferable[]
	): void;

	outputTransferList(
		fn: (output: Output) => Transferable[]
	): void;

	alias(alias: string): void;

	start(): void;
	stop(): void;

	inputLatency?: number;
	outputLatency?: number;
}