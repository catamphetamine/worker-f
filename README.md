[![npm downloads](https://img.shields.io/npm/dm/worker-f.svg?style=flat-square)](https://www.npmjs.com/package/worker-f)

# worker-f

Runs a function in a separate thread in a web browser or Node.js.

[Demo](https://catamphetamine.gitlab.io/worker-f/)

## Why

* The code is universal and could be run in any environment: in a web browser or Node.js. The easy-to-use API hides the complexity of dealing with each particular environment.

* Doesn't require moving code to a separate file for it to be able to run in a worker. This prevents introducing the unnecessary and redundant concept of being able to access a "filesystem" or having to run a "web server". The code must not concern itself with such things that're completely irrelevant to its purpose. It shouldn't even know that a concept of a "file path" exists. Running a function in a separate thread should be as simple as it is in other programming languages.

* Because it removes the unnecessary requirement of being able to access a "filesystem" or running a "web server", it becomes possible to use workers in "libraries" ("packages"), not just end-user applications. For example, [`fflate`](https://www.npmjs.com/package/fflate) uses workers to utilize multiple CPU cores (and to prevent freezing of the page) when zipping or unzipping large archives.

* Why use workers at all? In a web browser, it's about not freezing the app while doing "heavy computation". In Node.js, it's about not freezing the server while doing "heavy computation". And while freezing an app in a web browser is somewhat bearable, the main appeal of Node.js from the point of its creation has been that it doesn't "fork" the process for each incoming HTTP request, outperforming "classic" web servers by using an "event loop" instead, which quickly backstabs if that "event loop" is accidentally blocked by a "heavy computation".

## Install

```
npm install worker-f
```

Alternatively, it could be included on a web page [directly](#cdn) via a `<script/>` tag.

## Use

Basic usage:

```js
const workerFn = workerFunction((a, b) => a + b)

await workerFn.callOnce(1, 2) === 3
```

Advanced usage scenarios like "calling multiple times", "streaming", "caching", "transferring data" are described further in this document.

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

### Call Once

Use this when the function will only be called once. Attempting to call the function second time will throw an error.

The function could be synchronous or asynchronous.

```js
import workerFunction from 'worker-f/node'

const workerFn = workerFunction((a, b) => a + b)

await workerFn.callOnce(1, 2) === 3
```

### Call

When the function will be called multiple times, it should be started, then called as many times as needed, then stopped.

```js
import workerFunction from 'worker-f/node'

const workerFn = workerFunction((a, b) => a + b)

workerFn.start()

await workerFn.call(1, 2) === 3
await workerFn.call(4, 5) === 9

workerFn.stop()
```

If the function [rejects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) or throws an error, it will automatically stop.

If a developer forgets to stop a worker function that is no longer used, it will still stop automatically when the code no longer holds any "[reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management)" to it. It will also stop automatically when the web browser tab is closed, or the Node.js process is killed. But until stopped, it will keep holding its memory.

### Stream

If a function is designed to produce multiple outputs for a given input, or to produce output without any input at all, then it should use "stream" API rather than "call" API.

To use "stream" API, add `/stream` postfix to the `import` path.

```js
import createWorkerStream, { type Emit } from 'worker-f/node/stream' // or 'worker-f/browser/stream'

// In this example, we create an "adder" stream that receives two numbers
// and outputs their sum, along with a supplementary "counter" number.
type Input = [number, number]
type Output = [number, number]

// Create an "adder" stream.
const workerStream = createWorkerStream(
  // Anything that happens inside these parentheses happens in a worker thread.
  // In other words, you cannot reference anything outside of these parentheses
  // because these parentheses are an impenetrable barrier between two parallel worlds —
  // the world of the main thread and the world of a worker thread.
  // These two worlds can communicate by passing input or output across the barrier,
  // but they won't ever "see" each other.
  //
  // So here we define the code that runs in isolation in a worker thread.
  // The only things you've got here are: any kind of input that the main thread
  // decides to send to this worker stream, and a reference to an `emit()` function
  // that can be used to send any kind of output to the main thread. That's it.
  //
  // If you're using TypeScript, then you must also pre-define the type of data
  // that you'll be emitting using the `emit()` function.
  //
  (emit: Emit<Output>) => {
    // The code inside this function will only be run once when you call `workerStream.start()`,
    // and any variables declared here will exist until you call `workerStream.stop()`,
    // so this is a good place to declare any "state" variables.
    //
    // For example, here we declare a "counter" variable.
    // It will count the number of "sum" operations it did so far.
    //
    let count = 0

    // In the end, we return an "input handler" function.
    // This function should (optionally) process any input in some kind of way
    // and then (optionally) use the `emit()` function to output some kind of result
    // back to the main thread.
    //
    // In this example, the "input handler" function receives two numbers as an input,
    // calculates their sum, and outputs it to the main thread, along with the count
    // of "sum" oprations it did so far.
    //
    return ([a, b]: Input) => {
      // Increase the number of "sum" oprations it did so far.
      count++
      // Calculate a sum of the two input numbers and send the result back
      // to the main thread, along with the number of "sum" oprations it did so far.
      emit([a + b, count])
    }
  }
)

// Here, we're back in the main thread.

// Stores the results of adding two numbers.
const sums = []

// How many outputs it still expects from the "adder" stream.
let pendingOperations = 0

// Calling `.onOutput()` sets up a listener that will handle any output from the stream.
// Calling `.onOutput()` multiple times will just overwrite the listener.
workerStream.onOutput(([sum, counter]) => {
  sums[counter - 1] = sum
  pendingOperations--
  // When all outputs have been received.
  if (pendingOperations === 0) {
    // Validate the end result.
    sums.length === 3
    sums[0] === 3
    sums[1] === 7
    sums[1] === 11
    // Stop the worker stream.
    workerStream.stop()
  }
})

// (optional)
//
// Calling `.onError()` sets up a listener that will intercept any errors
// that're thrown from the worker stream.
//
// Calling `.onError()` multiple times will just overwrite the error listener.
//
// Even if an error is intercepted, the worker stream will still automatically stop.
// By default, if no `.onError()` listener is added, any error thrown from a worker stream
// will just propagate to the main thread as an "unhandled rejection", crashing the app.
//
workerStream.onError((error) => {
  console.log('Worker stream exited with an error', error)
})

workerStream.start()

pendingOperations++
workerStream.push([1, 2])

pendingOperations++
workerStream.push([3, 4])

pendingOperations++
workerStream.push([5, 6])
```

## External Dependencies

An "isolated" function only uses the stuff that is defined within its body, and it never references anything from outside of its body. This is basically a requirement for any function that is to be extrated to a separate (worker) thread.

But in practice that's not always the case. More likely, a worker function is going to reference some variables or classes or other functions that're declared outside of its body. In that case, those variables or classes or functions must be specified as the worker function's "dependencies", or else it would throw a `ReferenceError: <name> is not defined`.

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

Any external dependencies that're not functions (or classes) must be [clonable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), i.e. they can't be arrays of functions (or classes) or JSON objects with values that're functions (or classes), etc. Otherwise, it would throw a `DataCloneError`.

Any external dependencies that're functions (or classes) must either be "isolated", or specify their own external dependencies in an `.addDependencies(...)` call, in which case the loop continues until the very last sub-sub-sub-dependency function (or class) is finally "isolated".

```js
// External function that is "isolated" because it doesn't reference anything outside of its body
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

To reduce the number of external dependencies, one could put everyting into a single large "isolated" function that doesn't reference anything outside of its body. Or if it does reference anything outside of its body, those references themselves must be "isolated" functions (or classes) that don't reference anything outside of their body, etc.

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

const sumFn = workerFunction(sum)
sumFn.addDependencies(() => [c])

// Calling `.alias()` creates a snapshot of this worker function.
// After assigning an alias, one could instantiate this type of worker function from the snapshot.
// The snapshot will include both the `sum` function body and any of its dependencies.
//
// Creating a new worker function from an alias will be slightly faster than from a function body
// because it won't have to redo the stringification of the function body and any of its dependencies.
// Does it really matter performance-wise? I didn't bother checking.
//
sumFn.alias('sum')

// (optional)
await sumFn.callOnce(2, 3) === 6

// Create a new worker function by the alias.
const sumFn2 = workerFunction<Args, Result>('sum')
await sumFn2.callOnce(4, 5) === 10

// Create a new worker function by the alias.
const sumFn3 = workerFunction<Args, Result>('sum')
await sumFn3.callOnce(6, 7) === 14
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
workerFn.push(1, 2)

// Return the worker to the pool here and unsubscribe from any responses or errors.
// But what if the worker is still processing some previously received data.
// In that case, if someone picks this worker function afterwards, and starts listening to it,
// they could receive those completely unrelated echo-from-the-past `emit()` calls,
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

* For `ArrayBuffer`s, "cloning" is said to be "[incredibly quick](https://github.com/GoogleChromeLabs/buffer-backed-object)" without any further details.

So the short answer is: "I personally don't really know or care". The rule of thumb is to keep the data being sent between the main thread and the worker thread to a minimum.

To assess input/output "cloning" performance, every worker function exposes two properties — `inputLatency` and `outputLatency` (in milliseconds).

<details>
<summary>How to read and interpret <code>inputLatency</code> and <code>outputLatency</code></summary>

######

`inputLatency` and `outputLatency` are readable from a worker function instance in the main thread and are updated every time the function has been [called](#call):
* `inputLatency` is how long it took for the main thread to send data to the worker thread, i.e. create a "serialized" copy of the data in the main thread and then "de-serialize" it in the worker thread.
* `outputLatency` is how long it took for the worker thread to send data back to the main thread, i.e. create a "serialized" copy of the data in the worker thread and then "de-serialize" it in the main thread.

```js
const workerFn = workerFunction((a, b) => a + b)

workerFn.start()

await workerFn.call(1, 2) === 3

// `inputLatency` is how long it took to send numbers `1` and `2` to the worker thread
console.log(workerFn.inputLatency)

// `outputLatency` is how long it took to send number `3` back to the main thread
console.log(workerFn.outputLatency)

await workerFn.call(3, 4) === 7

// `inputLatency` is how long it took to send numbers `3` and `4` to the worker thread
console.log(workerFn.inputLatency)

// `outputLatency` is how long it took to send number `7` back to the main thread
console.log(workerFn.outputLatency)

workerFn.stop()
```

Why are `inputLatency` and `outputLatency` an important factor, and why seeing high values could indicate a problem? Because "cloning" is "synchronous", it blocks the main thread every time when cloning input/output data. This means that passing huge chunks of data between the main thread and the worker thread could "block" the main thread for even longer than it would take to actually process those chunks of data, defeating the whole purpose of using a worker to improve performance or responsiveness of an app. So seeing large numbers in `inputLatency` or `outputLatency` might indicate that the whole purpose of using a worker is being defeated.

Sending large chunks of data is only viable via [transfer](#transfer) method and only for binary data because it's the only case when it doesn't block the main thread and sending such data is basically free. If data is not binary, but still large, the only option is to transfer it in small-enough chunks that're spread out in time using [streaming](#stream) so that the main thread doesn't block for too long.

When speaking of "streaming" API, the input/output latency concept becomes a bit trickier, because the data flow is now "asynchronous" rather than a straight "data in → data out" loop, and a given input doesn't necessarily cause a given output. So when reading `inputLatency` and `outputLatency` upon receiving yet another output, one can easily tell which exact output the `outputLatency` is for, but one can't really tell which exact input the `inputLatency` is for — it's for whatever input was the most recent one by the time it sent the output.

```js
import createWorkerStream, { type Emit } from 'worker-f/node/stream'

// Sums input numbers.
const workerStream = createWorkerStream(
  (emit: Emit<number>) => {
    // Input numbers will be accumulated here.
    let numbers = []
    // A worker stream could send some output to the main thread
    // even before in receives any input from the main thread.
    emit(0)
    // Calculates a sum of accumulated numbers.
    return (number: number) => {
      // Append this number to the list of accumulated numbers.
      numbers.push(number)
      // As soon as it has accumulated 3 numbers.
      if (numbers.length === 3) {
        // Calculate a sum of the 3 numbers and send the value to the main thread.
        emit(numbers.reduce((sum, number) => sum + number))
        numbers = []
      } else {
        // Not enough numbers accumulated yet.
        // This is an example of how there might not necessarily be an output for a given input.
      }
    }
  }
)

workerStream.onOutput((sum) => {
  // `inputLatency` is the "latency" of the latest input
  // `outputLatency` is the "latency" of the latest output
  //
  // Specifically:
  //
  // * The first received output is `0`
  //   * `inputLatency` is `undefined`
  //   * `outputLatency` is the "latency" of this output
  // * The second received output is `6`
  //   * `inputLatency` is the "latency" of the `3` input
  //   * `outputLatency` is the "latency" of this output
  //
  console.log(workerStream.inputLatency)
  console.log(workerStream.outputLatency)
})

workerStream.start()

// An output of `0` will be received shortly after the worker stream has started.

// Send the first number to the worker — no output.
workerStream.push(1)

// Send the second number to the worker — no output.
workerStream.push(2)

// Send the third number to the worker — outputs `1 + 2 + 3 === 6`
workerStream.push(3)

// (later) When the application is being closed
workerStream.stop()
```

Another tricky aspect of interpreting `workerStream.inputLatency` in a "streaming" scenario is that it could be affected by a potential clogging of the input queue. Because processing input data in a worker thread is meant to be a computationally heavy operation, it would be natural for the worker thread to "block" while it's processing a given input, causing any subsequent input to wait in line, which adds to the `inputLatency` of that next input. So in a "streaming" scenario, a rise in `inputLatency` doesn't necessarily indicate an issue with "cloning" large data, but rather establishes a fact that input is being sent to the worker stream faster than it can process it, which is absolutely normal.

Same effect could be observed on rising `outputLatency` when sending new output data chunks to the main thread while it's still "blocked" processing previous chunks and can't really receive new ones yet, causing clogging of the output queue. This would indicate a problem if the whole point of using a worker is to "unblock" the main thread. But first make sure that you're not calling `console.log(workerStream.outputLatency)` for a lot of output data chunks in rapid succession because, funny enough, doing that would itself cause the "blocking" of the main thread and the rise of `outputLatency`.
</details>

## Transfer

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

Any errors thrown within a worker function will "bubble" to the main thread:

* When using "call" API, if the function [rejects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) or throws an error, the returned `Promise` will be rejected and the worker function will automatically stop.

* When using "stream" API, the optional `.onError(listener)` listener will be called and the worker function will automatically stop.

But there's a catch: an `error` that "bubbles" from a worker function to the main thread will have its class rewritten with generic `Error`, and it will no longer be an instance of the original error class. This is because any error has to be "serialized" and then "de-serialized" in order to be sent from the worker thread to the main thread. So a "bubbled" `error` will still retain all the properties of the original error, including `name`, but it will no longer be an instance of the original error class. Consider this when your application detects error type using `instanceof` operator, and perhaps resort to comparing `error.name` property instead.

Also, if instead of throwing an `error`, a worker function sends it to the main thread as a usual value, then the `error` will neither retain its original class nor any of its properties: the class will be reset to generic `Error`, `name` will be rewritten with `"Error"`, and any other properties will just be discarded.

## Transpilers

This package can't be used with any transpilers such as [Babel](https://babeljs.io). This is because they insert their own helper functions at the top level of the transpiled code, so those helper functions become undeclared [external dependencies](#external-dependencies) that aren't possible to be declared beforehand in the original source code. As a result, when running such transpiled code, it throws an error: `<helper-function-name> is not defined`.

## CDN

To include this library directly via a `<script/>` tag on a page, one can use any npm CDN service, e.g. [unpkg.com](https://unpkg.com) or [jsdelivr.com](https://jsdelivr.com)

```html
<script src="https://unpkg.com/worker-f@0.1.x/bundle/worker-f.min.js"></script>

<script src="https://unpkg.com/worker-f@0.1.x/bundle/worker-f-stream.min.js"></script>

<script>
  const workerFn = workerFunction((a, b) => a + b)

  const workerStream = createWorkerStream((emit) => {
    return ([a, b]) => {
      emit(a + b)
    }
  })
</script>
```

## Development

```
npm install
npm test
```

It uses `vitest` to run unit tests, which also comes with a [bug](https://github.com/vitest-dev/vitest/issues/10692) on Windows when it doesn't know how to properly handle lowercase drive letter. The error message is `Error: Vitest failed to find the current suite. One of the following is possible`. The workaround is to `cd` into same directory but with an uppercase drive letter.