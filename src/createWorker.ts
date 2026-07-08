import type {
	CreateWorkerInEnvironment,
	GetDependencies,
	EnvironmentWorker,
	UniversalWorker
} from './createWorkerFunction.common.d.ts'

import stringifyFunctionReferences from './stringifyFunctionReferences.ts'

/**
 * Creates a worker.
 *
 * @example
 * ```js
 * // When running in a web browser.
 * import createWorkerInBrowser from './createWorkerInBrowser.ts'
 *
 * // Create a worker.
 * const workerFn = createWorkerFn(
 * 	// Creates a worker in a given environment.
 * 	createWorkerInBrowser,
 *
 * 	// (optional) Filters `transferList` argument.
 * 	undefined,
 *
 * 	// Any "outside" dependencies that're referenced in the function (below).
 * 	[() => [outsideVar1, outsideVar2, func1, func2]],
 *
 * 	// Returns a function in the worker that processes input data.
 * 	(respond) => {
 *  	return (data) => {
 * 			// Process the data (perform some kind of calculation).
 * 			const result = processData(data)
 * 			// Post the result of the calculation back to the main thread.
 * 			respond(result) // (optional) add `transferList` argument.
 * 		}
 *  },
 *
 * 	// A function in the main thread that will be called every time
 * 	// when the worker has finished processing the data
 * 	// (or threw an error while doing that).
 * 	(error, result) => {
 * 		if (error) {
 * 			workerFn.stop()
 * 			throw error
 * 		}
 * 		// If no more data will be passed to the worker, it should be terminated.
 * 		workerFn.stop()
 * 		console.log(result)
 * 	}
 * )
 *
 * workerFn.start()
 *
 * // Post a message with some data to the worker
 * // so that it starts processing the data
 * // and later posts a message back to the main thread
 * // with the result of the calculation.
 * workerFn.push(inputData) // (optional) add `transferList` argument.
 * ```
 *
 * @param {function} createWorkerInEnvironment — Creates a worker in a given environment. The worker must call globally-available `onMessage(data)` function every time it receives a message, and it must define a `var postMessage = (data) => void` function that posts a message to the parent (main) thread.
 * @param {function} createInputHandler — A "creator" that creates a function that will be called with message data every time a message is sent to this worker. The "creator" function receives a single argument — a function that posts data back to the main thread, with two arguments: `data` and (optional) `transferList`.
 * @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
 * @param {function} onOutput — This function will be called every time when done processing an incoming message.
 * @param {function} getFromCache — Could be used to add caching. Has no arguments. Returns the cached value.
 * @param {function} setInCache — Could be used to add caching. Receives the value to cache as an argument. Doesn't return anything.
 * @returns {Worker} — An object with methods: `start(getDependenciesFunctionOrArrayOfGetDependenciesFunctions)`, `stop()`, `push(data, [transferList])`. Calling `stop()` requests termination of the worker. Calling `stop()` multiple times is safe and will not throw any errors.
 */
export default function createWorker<Input, Output>(
	createWorkerInEnvironment: CreateWorkerInEnvironment,
	createInputHandler: CreateInputHandler<Input, Output>,
	onError: (error: unknown) => void,
	onOutput: (output: Output) => void,
	getFromCache: () => CacheValue | undefined,
	setInCache: (value: CacheValue) => void
): UniversalWorker {
	// Was the worker ever started?
	let started = false

	let worker: EnvironmentWorker

	// Starts the worker.
	const start = (
		arrayOfGetDependenciesFunctions: GetDependencies[],
		dependenciesTransferList?: Transferable[]
	) => {
		// A worker can't be started twice or restarted after being stopped.
		if (started) {
			throw new Error('Already started')
		}

		started = true

		const cacheValue = getFromCache()
		const cachedCodeAndVars = cacheValue && cacheValue.codeAndVars
		const codeAndVars = cachedCodeAndVars || getCodeAndVars(createInputHandler, arrayOfGetDependenciesFunctions)
		if (!cachedCodeAndVars) {
			setInCache({ codeAndVars })
		}

		const {
			code,
			vars
		} = codeAndVars

		// Cache accessors for use in `createWorkerInEnvironment`.
		const getOtherFromCache = () => {
			const properties = getFromCache()
			if (properties) {
				return properties.other
			}
		}
		const setOtherInCache = (value: CacheValue['other']) => {
			setInCache({
				...getFromCache(),
				other: value
			})
		}

		// Create a worker in a specific environment.
		worker = createWorkerInEnvironment(
			code,
			getOtherFromCache,
			setOtherInCache,
			onError,
			onOutput
		)

		// Here is still the main thread code.
		// Initialize the worker with the global variables by sending a message with the variables
		// to the worker.
		//
		// `transferList` is not used here because using it would result in the corresponding
		// values to become "detached" from the main thread, and, therefore, unusable at next
		// creation of same type of worker (if there'll ever be one).
		//
		if (vars) {
			worker.push(vars, dependenciesTransferList)
		}
	}

	return {
		start,
		stop: () => {
			worker.stop()
		},
		push: (data: unknown, transferList?: Transferable[]) => {
			worker.push(data, transferList)
		}
	}
}

const JAVASCRIPT_CODE_ADDITIONAL_BEFORE_CREATE_MESSAGE_HANDLER_FUNCTION_CODE =
	// Handles any messages that're sent from the main thread.
	'var onMessage = function(data) {' +
		// The first message from the main thread will initialize the variables.
		// Put all initialization variables in the global scope.
		'for (var key in data) {' +
			'self[key] = data[key]' +
		'}' +
		// Any subsequent messages from the main thread will be handled
		// by a custom message handler returned from the supplied "creator" function.
		'onMessage = ('

const JAVASCRIPT_CODE_ADDITIONAL_AFTER_CREATE_MESSAGE_HANDLER_FUNCTION_CODE =
		')(postMessage)' +
	'}'

function getCodeAndVars<MessageData, Response>(
	createInputHandler: CreateInputHandler<MessageData, Response>,
	arrayOfGetDependenciesFunctions: GetDependencies[]
) {
	const {
		functionDefinitions,
		vars
	} = createCodeAndVars(arrayOfGetDependenciesFunctions)

	// Create javascript code of the worker.
	return {
		code:
			functionDefinitions +
			';' +
			JAVASCRIPT_CODE_ADDITIONAL_BEFORE_CREATE_MESSAGE_HANDLER_FUNCTION_CODE +
			createInputHandler.toString() +
			JAVASCRIPT_CODE_ADDITIONAL_AFTER_CREATE_MESSAGE_HANDLER_FUNCTION_CODE,

		vars
	}
}

function createCodeAndVars(arrayOfGetDependenciesFunctions: GetDependencies[]) {
	let funcs: Record<string, string> = {}
	let vars: Record<string, unknown> = {}

	for (const getDependencies of arrayOfGetDependenciesFunctions) {
		// Get stringified `functions` and `values`.
		const { functions, variables } = stringifyFunctionReferences(getDependencies)

		// Put the `functions` in the combined map.
		// If some keys get overridden, that's considered ok
		// because those're supposed to be the same global functions.
		funcs = {
			...funcs,
			...functions
		}

		// Put the `values` in the combined map.
		// If some keys get overridden, that's considered ok
		// because those're supposed to be the same global variables.
		vars = {
			...vars,
			...variables
		}
	}

	return {
		functionDefinitions: Object.keys(funcs).map((functionName) => {
			return functionName + '=' + funcs[functionName]
		}).join(';'),

		vars
	}
}

interface CodeAndVars {
	code: string;
	vars: Record<string, unknown>;
}

interface CacheValue {
	codeAndVars?: CodeAndVars;
	other?: any;
}

type CreateInputHandler<InputData, OutputData> = (
	send: (outputData: OutputData, transferList?: Transferable[]) => void
) => (inputData: InputData) => void