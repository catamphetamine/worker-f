// This source code was originally copy-pasted from `fflate`'s repository
// and then refactored according to my personal taste. Also added comments.
// https://github.com/101arrowz/fflate/blob/master/src/worker.ts

import type { EnvironmentWorker } from '../createWorker.ts'

/**
 * Creates a worker in a web browser.
 *
 * Defines a `var postMessage = (data, [transferList]) => ...` function.
 * Requires a `var onMessage = (data) => ...` function to be defined.
 *
 * @param {string} javascriptCode
 * @param {function} onError — This function will be called every time when there was an error while processing an incoming message. It would be logical to call `worker.terminate()` inside this function.
 * @param {function} onOutput — This function will be called every time when done processing an incoming message.
 * @returns {Worker} — An object with methods: `ingest(data, transferList)`, `stop()`.
 */
export default function createWorkerInBrowser<OutputData>(
	javascriptCode: string,
	onError: (error: unknown) => void,
	onOutput: (output: OutputData) => void
): EnvironmentWorker {
	// Worker's code URL — "blob://..."
	let url = createWorkerCodeUrl(javascriptCode)

	// Create a worker.
	const worker = new Worker(url)

	// Cleans up the `Blob` object that holds the source code for the worker.
	//
	// Why:
	//
	// When a web browser creates a "blob:" URL from a `Blob`,
	// it increments the "reference counter" on that `Blob`
	// which prevents it from being garbage-collected
	// even when it's no longer referenced in the code.
	//
	// A solution is to call `URL.revokeObjectURL()` function manually
	// on the "blob:" URL representing the `Blob`. This decrements
	// the "reference counter" on that `Blob`, allowing it to be garbage-collected.
	//
	// The `URL.revokeObjectURL()` function shouldn't be called immediately
	// after calling `new Worker()` though, because that would cause issues in older browsers.
	// In those older browsers, `new Worker(blobUrl)` returns before the browser has fetched the script,
	// so revoking the "blob:" URL immediately races worker startup and fails the load outright
	// on slower engines. Because workers have no "loaded" event, the first `message` or `error` event
	// is the earliest point at which the worker code is known to have been evaluated, and it's when
	// the "blob:" URL is no longer needed.
	// https://github.com/maplibre/maplibre-gl-js/issues/8854
	// So this function should only be called in "message" or "error" handlers.
	//
	// Calling this function multiple times won't result in any difference.
	//
	const cleanUpBlob = () => {
		if (url) {
			URL.revokeObjectURL(url)
			url = ''
		}
	}

	// A "message" event fires in the main thread (i.e. here) whenever the worker
	// sends a message to the main thread. Because this code is the main thread,
	// here it sets up a message listener to receive results from the worker.
	// Upon receiving a result (or an error) from the worker, it calls the `callback`.
	worker.onmessage = (event) => {
		// Clean up the `Blob` object that holds the source code for the worker.
		cleanUpBlob()
		// See if it's an error message or a data message.
		const data = event.data
		const errorData = data ? data[ERROR_MESSAGE_PROPERTY_NAME] : undefined
		// If it's an error message.
		if (errorData) {
			// Create an `Error` instance from error data.
			const error = new Error(errorData[0])
			error.stack = errorData[1]
			let i = 2
			while (i < errorData.length) {
				(error as any)[errorData[i][0]] = errorData[i][1]
				i++
			}
			// Call `onError()` listener.
			onError(error)
			// The worker has already been requested to be terminated via `self.close()`
			// within the worker's code, so there's no need to call `worker.terminate()` here.
		} else {
			// If it's a data message.
			onOutput(data)
		}
	}

	// Listen for any errors that haven't been caught and `.preventDefault()`-ed
	// by the "error" event listener that was added directly in the worker's code
	// where it says `addEventListener("error", ...)`.
	//
	// After this error listener finishes, the browser checks whether the event was canceled.
	// If `event.preventDefault()` was not called, the browser proceeds with its default behavior,
	// which typically logs the uncaught error to the developer console.
	//
	worker.onerror = (event) => {
		// Clean up the `Blob` object that holds the source code for the worker.
		cleanUpBlob()
		// Call `onError()` listener.
		onError(
			// Create an `Error` instance from `event`.
			//
			// In most cases event is of type `ErrorEvent`, but for example in Chrome
			// when there is a worker error related to `Cross-Origin-Embedder-Policy` header,
			// the event is of type `Event` and has no `message` property.
			// https://github.com/microsoft/TypeScript-DOM-lib-generator/issues/1575
			//
			event instanceof ErrorEvent && event.error instanceof Error
				// If the browser attached an actual `Error` instance, return it directly.
				? event.error
				// If it's an `ErrorEvent` without an `.error` object,
				// or if it's a generic `Event` without a `message` property.
				: new Error(event.message || event.type)
		)
		// Terminate the worker immediately after an error has happened
		// in order to stay consistent with Node.js's behavior.
		// By default, web browsers don't terminate a worker on "error" event.
		//
		// If this "error" event propagated from the worker's code,
		// the worker has already been marked for termination automatically.
		// If this "error" event happened outside of the worker's code,
		// the worker has not been marked for termination automatically.
		//
		// Calling `worker.terminate()` will kill the worker thread immediately.
		// Calling `worker.terminate()` multiple times is safe and will not throw any errors.
		//
		worker.terminate()
	}

	return {
		stop() {
			// Calling `worker.terminate()` will kill the worker thread immediately.
			// Calling `worker.terminate()` multiple times is safe and will not throw any errors.
			worker.terminate()
			// Clean up the `Blob` object that holds the source code for the worker.
			cleanUpBlob()
		},
		ingest: worker.postMessage.bind(worker)
	}
}

function createWorkerCodeUrl(javascriptCode: string) {
	return URL.createObjectURL(
		new Blob([
			javascriptCode + ';' + JAVASCRIPT_CODE_ADDITIONAL
		], { type: 'text/javascript' })
	)
}

const ERROR_MESSAGE_PROPERTY_NAME = '$err$'

const JAVASCRIPT_CODE_ADDITIONAL =
	// Listen to incoming messages from the main thread.
	'self.onmessage = function(evt) {' +
		'onMessage(evt.data)' +
	'}' + ';' +
	// Reports an error to the main thread.
	'function onErr(err_, msg) {' +
		'var err = err_ instanceof Error ? err_ : new Error(msg)' + ';' +
		'postMessage({' +
			ERROR_MESSAGE_PROPERTY_NAME + ':' + '[' +
				// `message` is a "non-enumerable" property of an `Error` class
				// and it won't be present in `Object.keys(error)`.
				'err.message' + ',' +
				// `stack` is a "non-enumerable" property of an `Error` class
				// and it won't be present in `Object.keys(error)`.
				'err.stack' +
			'].concat(' +
				// Add any "rest" properties of the error such as `name` or `code`.
				'Object.keys(err).map(' +
					'function(k){' +
						'return[k,err[k]]' +
					'}' +
				')' +
			')' +
		'})' +
	'}' + ';' +
	// Define a `postMessage()` function that will be used to send messages to the main thread.
	'var postMessage = self.postMessage' + ';' +
	// Any "synchronous" errors that occur inside the worker's code will simply propagate
	// to `worker.onerror` listener in the main thread, so there's no need to handle them here.
	//
	// The word "synchronous" here means that it doesn't include "unhandled promise rejection" errors:
	// if a promise was rejected (including an uncaught throw  within an async function)
	// and no rejection handlers were attached, an `unhandledrejection` event will be fired
	// instead of an `error` event.
	//
  'addEventListener("error",' +
    // `evt` argument is an instance of `ErrorEvent` class, which inherits from `Event` class.
    // https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
    'function(evt) {' +
      // Call `event.preventDefault()` to prevent the error from propagating to the parent thread.
			// This also disables the automatic termination of the worker, so it will have to be terminated manually.
			// Why not propagate the error to the parent thread? Because here in the worker thread
			// there already is a convenient `onErr()` function for reporting "unhandled rejection" errors,
			// so why not reuse it for "synchronous" errors too. The `worker.onerror` handler in the parent thread
			// is pretty "basic", so reusing the `onErr()` function instead looks like a slightly better alternative,
			// not to mention the uniformity of handling errors in general.
			'evt.preventDefault()' + ';' +
      // Notify the main thread about this error so that it could call the `callback`.
      'onErr(evt.error, evt.message)' + ';' +
			// Terminate the worker immediately after an error has happened
			// in order to stay consistent with Node.js's behavior.
			'self.close()' +
    '}' +
  ')' + ';' +
	//
	// To catch `unhandledrejection` events, a separate event listener has to be added.
	// Otherwise, it will just propagate any such errors to parent thread.
	//
	'addEventListener("unhandledrejection",' +
		// `evt` argument is an instance of `PromiseRejectionEvent` class, which inherits from `Event` class.
		// https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
		'function(evt) {' +
      // Prevent the default behavior of logging the error in the browser console.
      // https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event#preventing_default_handling
			// This also disables the automatic termination of the worker, so it will have to be terminated manually.
			'evt.preventDefault()' + ';' +
			// Notify the main thread about this error so that it could call the `callback`.
			'onErr(evt.reason, String(evt.reason))' + ';' +
			// Terminate the worker immediately after an error has happened
			// in order to stay consistent with Node.js's behavior.
			'self.close()' +
		'}' +
	')'

type CacheValue = string