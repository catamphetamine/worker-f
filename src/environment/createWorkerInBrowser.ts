// This source code was originally copy-pasted from `fflate`'s repository
// and then refactored according to my personal taste. Also added comments.
// https://github.com/101arrowz/fflate/blob/master/src/worker.ts

import type { EnvironmentWorker } from '../createWorkerFunction.common.d.ts'

/**
 * Creates a worker in a web browser.
 *
 * Defines a `var postMessage = (data, [transferList]) => ...` function.
 * Requires a `var onMessage = (data) => ...` function to be defined.
 *
 * @param {string} javascriptCode
 * @param {function} getFromCache — Could be used to add caching. Has no arguments. Returns the cached value.
 * @param {function} setInCache — Could be used to add caching. Receives the value to cache as an argument. Doesn't return anything.
 * @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
 * @param {function} onOutput — This function will be called every time when done processing an incoming message.
 * @returns {Worker} — An object with methods: `push(data, transferList)`, `stop()`.
 */
export default function createWorkerInBrowser<OutputData>(
	javascriptCode: string,
	getFromCache: () => CacheValue | undefined,
	setInCache: (value: CacheValue) => void,
	onError: (error: unknown) => void,
	onOutput: (output: OutputData) => void
): EnvironmentWorker {
	// Worker's code URL — "blob://..."
	let url = getFromCache() as string
	if (!url) {
		url = createWorkerCodeUrl(javascriptCode)
		setInCache(url)
	}

  // Create a worker.
  const worker = new Worker(url)

  // A "message" event fires in the main thread (i.e. here) whenever the worker
  // sends a message to the main thread. Because this code is the main thread,
  // here it sets up a message listener to receive results from the worker.
  // Upon receiving a result (or an error) from the worker, it calls the `callback`.
  worker.onmessage = (event) => {
    const data = event.data
    const errorData = data[ERROR_MESSAGE_PROPERTY_NAME]
    if (errorData) {
      const [name, message, code, stack] = errorData
      const error = new Error(message)
      error.name = name; // This semicolon is required to prevent an error: "name is not a function" which is caused by an opening parenthesis on the next line.
      // `code` property doesn't exist on `Error` class
      // but it does exist in some of its subclasses.
      (error as any).code = code
      error.stack = stack
      onError(error)
			// Terminate the worker thread to mimick Node.js's "unrecoverable" behavior.
      worker.terminate()
    } else {
      onOutput(data)
    }
  }

  return {
    // Calling `worker.terminate()` will kill the worker thread immediately.
    // Calling `worker.terminate()` multiple times is safe and will not throw any errors.
    stop: worker.terminate.bind(worker),
    push: worker.postMessage.bind(worker)
  }
}

function createWorkerCodeUrl(javascriptCode: string) {
  return URL.createObjectURL(
    new Blob([
      javascriptCode + ';' + JAVASCRIPT_CODE_ADDITIONAL
    ], { type: 'text/javascript' })
  )
}

const ERROR_MESSAGE_PROPERTY_NAME = '$error$'

const JAVASCRIPT_CODE_ADDITIONAL =
  // Listen to incoming messages from the main thread.
  'self.onmessage = function(event) {' +
    'onMessage(event.data)' +
  '}' + ';' +
  // Sends a message to the main thread.
  'var postMessage = self.postMessage' + ';' +
  // Listen to any errors that occur inside the worker.
  'addEventListener("error",' +
    'function(event) {' +
      // The worker will halt execution (unless `event.preventDefault()` is called).
      // The error will be propagated to the main thread's console.
      // Notify the main thread about this error so that it could call the `callback`.
      'postMessage({' +
        ERROR_MESSAGE_PROPERTY_NAME + ':' + '[' +
          'event.error.name' + ',' +
          'event.error.message' + ',' +
          'event.error.code' + ',' +
          'event.error.stack' +
        ']' +
      '})' +
    '}' +
  ')'

type CacheValue = string