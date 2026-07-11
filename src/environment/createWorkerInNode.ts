// This source code was originally copy-pasted from `fflate`'s repository
// and then refactored according to my personal taste. Also added comments.
// https://github.com/101arrowz/fflate/blob/master/src/node-worker.ts

import { Worker } from 'node:worker_threads'

import type { EnvironmentWorker } from '../createWorker.ts'

/**
 * Creates a worker in Node.js.
 *
 * Defines a `var postMessage = (data, [transferList]) => ...` function.
 * Requires a `var onMessage = (data) => ...` function to be defined.
 *
 * @param {string} javascriptCode
 * @param {function} getFromCache — Could be used to add caching. Has no arguments. Returns the cached value.
 * @param {function} setInCache — Could be used to add caching. Receives the value to cache as an argument. Doesn't return anything.
 * @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
 * @param {function} onOutput — This function will be called every time when done processing an incoming message.
 * @returns {Worker} — An object with methods: `ingest(data, transferList)`, `stop()`.
 */
export default function createWorkerInNode<OutputData>(
	javascriptCode: string,
	getFromCache: () => CacheValue | undefined,
	setInCache: (value: CacheValue) => void,
	onError: (error: unknown) => void,
	onOutput: (output: OutputData) => void
): EnvironmentWorker {
	// This flag will be set to true upon calling `worker.terminate()`.
	// It will be used to tell if the worker terminated normally or abruptly.
  let requestedTermination = false

	let processedError = false

	// Worker's code.
	let code = getFromCache() as string
	if (!code) {
		code = createWorkerCode(javascriptCode)
		setInCache(code)
	}

	// Create a worker.
  const worker = new Worker(code, { eval: true })
    .on('error', (error) => {
			processedError = true
			onError(error)
			// A Node.js worker always "exit"s after an "error",
			// so there's no need to call `worker.terminate()`.
		})
    .on('message', (message) => {
			onOutput(message)
		})
		// The "exit" event is emitted once the worker has stopped.
		// If the worker exited by calling `process.exit()`, the `exitCode` parameter
		// is the passed exit code argument.
		// If the worker was terminated, the `exitCode` parameter is `1`.
    .on('exit', (exitCode) => {
			// * `exitCode: 0` means "the worker has finished execution without any issues".
			// * `exitCode: 1` immediately follows "error" message.
			// Any non-zero `exitCode` means "the worker was stopped due to an application error".
      if (exitCode && !processedError && !requestedTermination) {
				// It looks like the worker can't possibly execute any code after receiving
				// the "exit" event, so it's safe to call the `callback()` here.
				onError(new Error('Exited with code ' + exitCode))
			}
    })

  // Calling `stop()` will request termination of the worker.
  const stop = () => {
    requestedTermination = true
		// Stop all JavaScript execution in the worker thread as soon as possible.
		//
		// Returns a `Promise` for the exit `code`.
		// The returned `Promise` is fulfilled when the "exit" event is emitted.
		//
		// Calling `worker.terminate()` multiple times is safe and will not throw any errors.
		//
    const promise = Worker.prototype.terminate.call(worker)
		// Doesn't return the `Promise` in order for this API to be consistent with the web browser one.
  }

  return {
		stop,
		ingest: worker.postMessage.bind(worker)
	}
}

function createWorkerCode(javascriptCode: string) {
	return javascriptCode + ';' + JAVASCRIPT_CODE_ADDITIONAL
}

const JAVASCRIPT_CODE_ADDITIONAL =
	'var workerThreads = require("worker_threads")' + ';' +
  // Listen to incoming messages from the main thread.
	'workerThreads.parentPort.on("message", function(data) {' +
		'onMessage(data)' +
	'})' + ';' +
  // Sends a message to the main thread.
	'var postMessage = function(data, transferList) {' +
		'workerThreads.parentPort.postMessage(data, transferList)' +
	'}' + ';' +
	// In Node.js Workers, `self` is called `global`.
	// Any global variables in the `javascriptCode` can be accessed from
	// (and written to) by using `self.` prefix. It's not necessary to
	// access them through `self.` but it is an "officially supported" option.
	'self = global'
	// + ';' +
	// // In a web browser, a worker is allowed to call a global `close()` function
	// // in its code in order to terminate itself (instantly).
	// // Here, it emulates same type of functionality in Node.js (just in case).
	// 'self.close = process.exit'

type CacheValue = string