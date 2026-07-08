[![npm downloads](https://img.shields.io/npm/dm/worker-f.svg?style=flat-square)](https://www.npmjs.com/package/worker-f)

# worker-f

Runs a function in a separate thread in a web browser or Node.js.

## Why

* The code is universal and could be run in any environment: in a web browser or Node.js. The easy-to-use API hides the complexity of dealing with each particular environment.

* Doesn't require moving code to a separate file for it to be able to run in a worker. This prevents introducing the unnecessary and redundant concept of being able to access a "filesystem" or having to run a "web server". The code must not concern itself with such things that're completely irrelevant to its purpose. It shouldn't even know that a concept of a "file path" exists. Running a function in a separate thread should be as simple as it is in other programming languages.

## Install

```
npm install worker-f
```

## Use

Basic usage:

```js
const workerFn = workerFunction((a, b) => a + b)

workerFn.start()

await workerFn.call(1, 2) === 3
await workerFn.call(4, 5) === 9

workerFn.stop()
```

Advanced usage scenarios, like "streaming", are described further in this document.

## Import

This package provides a separate `import` path for each different environment, as described below.

### Browser

```js
import workerFunction from 'worker-f/browser'

const workerFn = workerFunction((a, b) => a + b)
```

### Node

```js
import workerFunction from 'worker-f/node'

const workerFn = workerFunction((a, b) => a + b)
```

## API

### Call

Calls a function with arguments and returns a result.

```js
import workerFunction from 'worker-f/node'

const workerFn = workerFunction((a, b) => a + b)

workerFn.start()

await workerFn.call(1, 2) === 3
await workerFn.call(4, 5) === 9

workerFn.stop()
```

The function can be called multiple times until stopped.

The function could be synchronous or asynchronous — doesn't matter.

If the function [rejects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) or throws an error, it will automatically stop.

If a developer forgets to stop a worker function that is no longer used, it will still stop automatically when the code no longer holds any "[reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management)" to it. It will also stop automatically when the web browser tab is closed, or the Node.js process is killed. But until stopped, it will keep holding its memory.

### Call Once

Use this when the function will only be called once. No need to start or stop the function manually — it all happens automatically. Attempting to call the function second time will throw an error.

```js
import workerFunction from 'worker-f/node'

const workerFn = workerFunction((a, b) => a + b)

await workerFn.callOnce(1, 2) === 3
```

### Stream

If a function is designed to produce multiple outputs over time, it should use "stream" API rather than "call" API.

```js
import workerFunction, { type Send } from 'worker-f/node/stream'

const workerFn = workerFunction(
  // Use `send()` to output anything from the function
  (send: Send<number>) => {
    // The code here will be run on `start()`
    // and anything declared here will exist until `stop()`,
    // so this is the place to define the function's state
    let counter = 0
    // Return an "input handler" function
    return (input: number) => {
      counter++
      send(input*input)
    }
  }
)

// The sum of all responses from the function
let total = 0

// How many responses it expects from the function
let pending = 0

// Listen to the responses from the function
workerFn.onOutput((output) => {
  total += output
  pending--
  // When all responses are received
  if (pending === 0) {
    // Validate the end result
    total === 14
    // Stop the worker function
    workerFn.stop()
  }
})

// Listen to any errors thrown by the function
workerFn.onError((error) => {
  // Handle the error here
  console.error(error)
  // The worker function will automatically stop after this
})

workerFn.start()

pending++
workerFn.send(1) // 1 * 1 === 1

pending++
workerFn.send(2) // 2 * 2 === 4

pending++
workerFn.send(3) // 3 * 3 === 9
```

## External Dependencies

Sometimes, a function is not "self-contained", and it references some variables or other functions from outside of the function body. In that case, those variables or functions must be specified as the function's "dependencies", or else it would throw a `ReferenceError: <name> is not defined`.

```js
// External variable
const c = 3
// External function
const d = () => 4

// This worker function references `c` and `d` which are outside of its body
const workerFn = workerFunction((a, b) => a + b + c + d())

// Without declaring `c` and `d` as "dependencies",
// it throws: "ReferenceError: c is not defined"
await workerFn.callOnce(1, 2)

// How to fix the error:
workerFn.addDependencies(() => [c, d])
// Now it works
await workerFn.callOnce(1, 2) === 10
```

Any external dependencies that're functions must either be "self-contained" functions or specify their own external dependencies in the `.addDependencies(...)` call. And the loop continues until the very last sub-sub-sub-dependency function is finally "self-contained".

```js
// External function that is "self-contained" because it doesn't reference anything outside of its body
const d = () => 4

// External function that references `d` which is outside of its body
const c = () => 3 + d()

// This worker function references `c` which is outside of its body
const workerFn = workerFunction((a, b) => a + b + c())

// Specifying just `c` is not enough because `d` is also an external sub-dependency
workerFn.addDependencies(() => [c])
// throws: "ReferenceError: d is not defined"
await workerFn.callOnce(1, 2)

// How to fix the error:
workerFn.addDependencies(() => [c, d])
// Now it works
await workerFn.callOnce(1, 2) === 10
```

To reduce the number of external dependencies, one could put everyting into a single large "self-contained" function that doesn't reference anything outside of its body. Or if it does reference anything outside of its body, those references themselves must be "self-contained" functions that don't reference anything outside of their body, etc.

With that in mind, one could see how specifying all the dependencies correctly could become a tedious task in a typical modular application where the code is spread over countless smaller modules, each of them importing other smaller modules, etc. So a better approach would be to just move everything — the function itself and most of its dependencies — into a single big "wrapper" function, as if we're back in 2000s, and then create a worker from it.

```js
// A "wrapper" function that has the same arguments as the original function
export function fn_(a, b) {
  // Any dependencies are put right here, inside the wrapper function body
  const d = () => 4
  const c = () => 3 + d()

  // The original function is also put here
  const fn = (a, b) => a + b + c()

  // Call the original function with the arguments
  return fn(a, b)
}
```

```js
// Create a worker from the "wrapper" function.
// No need to specify any external dependencies because there're none. Simple.
const workerFn = workerFunction(fn_)
```

Needless to say that after a worker function has been started, none of its dependencies should change because those changes won't be reflected inside the worker function's thread, i.e. it won't "see" any changes.

## Caching

Every time a new worker function is created, it has to stringify the function body in order to generate the worker's code. If the application plans on creating many workers from same function, and that function has no [external dependencies](#external-dependencies) or those dependencies are constant, then it would make sense to only generate the function's source code once and then reuse it every time a new worker is created from this function.

To "cache" a function's source code for creating future workers, call `.alias()` method on the worker function.

```js
const c = () => 1
const sum = (a, b) => a + b + c()

const sumFn_ = workerFunction(sum)
sumFn_.addDependencies(() => [c])

// Calling `.alias()` creates a snapshot of this worker function.
// After assigning an alias, one could instantiate this type of worker function from the snapshot.
// The snapshot will include both the `sum` function body and any of its dependencies.
//
// Creating a new worker function from an alias will be slightly faster than from a function body
// because it won't have to redo the stringification of the function body and any of its dependencies.
// Does it really matter performance-wise? I didn't bother checking.
//
sumFn_.alias('sum')

// Create a new worker function by the alias.
const sumFn = workerFunction<Args, Result>('sum')
await sumFn.callOnce(2, 3) === 6

// Create another worker function by same alias.
const sumFn2 = workerFunction<Args, Result>('sum')
await sumFn2.callOnce(4, 5) === 10
```

<!--
## Pooling

This package could potentially export a `Pool` class which would create a "pool" of N workers. In that case, `.callOnce()` function would throw an error, and only `.call()` function would be usable. The `.onOutput()` function would be supported too, along with `onError()` function.

```js
import workerFunction, { Pool } from 'worker-f'

const workerFn = workerFunction((a, b) => a + b)

// The argument `10` is the `concurrency` setting (the number of workers in the pool).
// The `workerFn` must not have `.start()`ed.
// It should be automatically cached without any explicit passing of any kind of cache key string.
const workerFns = new Pool(workerFn, 10)

// Creates and starts the worker functions in the pool.
workerFns.start()

// Calling `.call()` puts the input arguments to an invocation queue.
// The returned `Promise` resolves or rejects when a worker becomes available.
// In case of rejection, it should terminate the acquired worker and create a new one it its place.
// It could also support some kind of a timeout option.
await workerFns.call(1, 2) === 3

// Calling `pick()` acquires a random worker function from the pool.
// It returns a `Promise` that resolves when a worker becomes available.
// It could also support some kind of a timeout option.
const workerFn = await workerFns.pick()

workerFn.onOutput((output) => {
  console.log(output)
})

workerFn.onError((error) => {
  console.error(error)
})

// Send input data to the picked worker function.
workerFn.send(123)

// Return the worker to the pool here and unsubscribe from any responses or errors.
// But what if the worker is still processing some previously received data.
// In that case, if someone picks this worker function afterwards, and starts listening to it,
// they could receive those completely unrelated echo-from-the-past `send()` calls,
// so this worker is not really safe to be reused because it could procude such
// "ghost" responses. And if workers can't really be reused after being returned to the pool,
// there'd be no point in such pooling in the first place (for streaming-type functions).
// Because of this, I think that `.onOutput()`-type workers aren't really viable for pooling.
// Only `.call()` ones seem to be poolable.
workerFns.return(workerFn)

// Stops all the worker functions in the pool.
// Sets a flag to not allow any further `.call()`s or `.onOutput()`s.
workerFns.stop()
```

* Universal pool implementation:
  * https://medium.com/@sohail_saifi/an-advanced-guide-to-web-workers-in-javascript-for-performance-heavy-tasks-67d27b5c2448
* Node.js pool implementation:
  * https://nodejs.org/api/async_context.html#using-asyncresource-for-a-worker-thread-pool
-->

## Performance

By default, any input passed to a worker function is [cloned](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) behind the scenes. And same goes for any output.

Because of how seamless the "cloning" is, developers don't even have to bother knowing that it takes place.

Yet, in some situations, the data being passed between the main thread and the worker thread might become large-enough to justify tinkering with potential optimization.

How large is "large-enough"?

* For JSON objects, the deeper the object is, the more costly it is to "serialize" and "deserialize" it back. There're some [benchmarks](https://surma.dev/things/is-postmessage-slow) from 2019 where it shows how "serializing"/"deserializing" a `10 MB` JSON object with `6` levels of nesting is about `50 ms` on a desktop or `100 ms` on a phone.

* For `ArrayBuffer`s, the cloning is said to be "[incredibly quick](https://github.com/GoogleChromeLabs/buffer-backed-object)" without any further details.

So the short answer is: "I personally don't really know or care". The rule of thumb is to keep the data being sent between the main thread and the worker thread to a minimum.

Sidenote: The "cloning" is "synchronous" so it blocks the main thread until it finishes cloning.

## Transfer List

When passing `ArrayBuffer`s, there's an optional feature called "[transfer](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)". When it "transfers" a buffer, it doesn't clone it, but instead it simply "transfers" the ownership of the buffer from the "main thread" to the "worker thread", and vice versa, which is a "free" operation. Although note that after a buffer has been "transferred", it's no longer usable in the code that "transferred" it.

To enable "transfer" for certain input/output buffers, call `inputTransferList()` / `outputTransferList()` methods on a worker function.

```js
// A worker function with some input and output.
const parser = workerFunction((arrayBuffer, dataType) => {
  // ... Parse the data from the buffer according to the data type ...
  return data
})

// Pass a function that returns a `transferList` for the input of the worker function.
// By default, an empty `transferList` is used for the input of the worker function.
parser.inputTransferList((arrayBuffer, dataType) => [arrayBuffer])

// Pass a function that returns a `transferList` for the output of the worker function.
// By default, an empty `transferList` is used for the output of the worker function.
parser.outputTransferList((data) => [])

// Now, when passing an `arrayBuffer` to the worker function,
// it will be "transferred" from the main thread to the worker thread.
const data = await parser.callOnce(arrayBuffer, 'document')
```

<!--
If the function has any `ArrayBuffer` dependencies, those could be "transferred" too instead of cloning them.

```js
// Secret key is a global variable that will be reused throughout multiple calls.
// Therefore, it should either be carefully passed back and forth via "transfer",
// or not be transferred at all and just be cloned every time, which is safer and simpler.
const secretKey = new ArrayBuffer(256)

// This worker function encrypts data.
const workerFn = workerFunction((data) => {
  // ... Encrypt the data using `secretKey` ...
  return encryptedData
})

// `secretKey` is an "external dependency"
// that is referenced from inside the function body.
// It will be cloned rather than "transferred".
workerFn.addDependencies(() => [secretKey])

// If we suddenly decided that `secretKey` should be "transferred" rather than cloned:

// `.transferDependency()` function will be called for each external dependency
// that was specified via `.addDependencies()`.
//
// Sidenote: In Node.js, it should additionally check every candidate for transfer
// by calling `isMarkedAsUntransferable()` function imported from "worker_threads" module.
// If that function returns `true`, the dependency should not be transferred,
// otherwise it will throw an error during the transfer process.
// Or, perhaps, it would be cleaner to not perform that check and instead let it throw the error.
// This way, the code becomes untied from Node.js implementation details, and the delopeers
// should be aware anyway that they shouldn't manually include such stuff in `transferList`.
//
workerFn.transferDependency((dependency, setDependencyValue) => {
  if (dependency instanceof Uint8Array) {
		// A `Uint8Array` is just a convenience wrapper around an `ArrayBuffer`.
		// The actual data is held by that `ArrayBuffer`.
		// For any `Uint8Array` dependency, it will add its underlying `ArrayBuffer`
		// to the `transferList`.
    //
		// But simply reading the `buffer` property of a `Uint8Array` is not advised
		// because it could potentially return an "incorrect" buffer
		// because `Uint8Array` allows custom offset and custom length.
		// Instead, the officially recommended way is to either clone a `Uint8Array`
		// by calling its constructor on itself, and then read its `buffer` property, or:
    // `uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength)`
    dependency = new (dependency.constructor)(dependency)
    // Because the dependency will be "transferred", it will become "detached" from the main thread
    // and the main thread won't be able to use it anymore. But it has to be used by it when making
    // another call of this worker function. To resolve this issue, the dependency must be either
    // passed back before another call, or the actual global variable must be left untouched
    // and cloned before transferring it, which then negates the whole point of going through
    // the hassle of transferring it in the first place. There're just some thoughts.
    // That's why I decided that perhaps it won't even make sense to transfer any dependencies at all.
    setDependencyValue(dependency)
    // Return the transferred buffer.
    return dependency.buffer
  }
})
```
-->

## Errors

When using "call" API, if the function [rejects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) or throws an error, the returned `Promise` will be rejected and the worker function will automatically stop.

When using "stream" API, the optional `.onError()` listener will be called and the worker function will automatically stop.

## Development

```
npm install
npm test
```

It uses `vitest` to run unit tests, which also comes with a [bug](https://github.com/vitest-dev/vitest/issues/10692) on Windows when it doesn't know how to properly handle lowercase drive letter. The error message is `Error: Vitest failed to find the current suite. One of the following is possible`. The workaround is to `cd` into same directory but with an uppercase drive letter.