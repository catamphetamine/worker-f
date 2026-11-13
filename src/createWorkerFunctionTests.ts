import { expect, test } from 'vitest'

import type { CreateWorkerInEnvironment } from './createWorker.ts'
import createWorkerStream, { type Emit } from './createWorkerStream.ts'
import createWorkerFunction from './createWorkerFunction.ts'

const INTER_THREAD_COMMUNICATION_DELAY = 150

export default function runTests(env: CreateWorkerInEnvironment) {
	test('create and call a function', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => a + b)
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Not started')
		workerFn.start()
		expect(() => workerFn.start()).toThrow('Was started')
		expect(await workerFn.call(1, 2)).toEqual(3)
		workerFn.stop()
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Was stopped')
		workerFn.stop()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Was stopped')
	})

	test('create and call a function once', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => a + b)
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Not started')
		expect(workerFn.inputLatency).toBeUndefined()
		expect(workerFn.outputLatency).toBeUndefined()
		expect(await workerFn.callOnce(1, 2)).toEqual(3)
		expect(workerFn.inputLatency).toBeTypeOf('number')
		expect(workerFn.outputLatency).toBeTypeOf('number')
		expect(() => workerFn.start()).toThrow('Was stopped')
		await expect(async () => await workerFn.callOnce(1, 2)).rejects.toThrow('Was stopped')
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Was stopped')
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Was stopped')
		workerFn.stop()
	})

	test('create and listen to a worker stream', async () => {
		const workerStream = createWorkerStream(env, (emit: Emit<[number, number] | string>) => {
			let count = 0
			// An streaming worker function could receive multiple arguments from the main thread.
			return ([a, b]: [number, number]) => {
				count++
				// An streaming worker function could send multiple arguments to the main thread.
				emit([a + b, count])
				emit(String(a + b + count))
			}
		})
		expect(workerStream.inputLatency).toBeUndefined()
		expect(workerStream.outputLatency).toBeUndefined()
		let responseCounter = 0
		// First time adding an error listener — the listener doesn't do anything.
		workerStream.onOutput((error) => {
			expect(true).toEqual(false)
		})
		// First time adding an output listener — overwrites the first one.
		workerStream.onOutput((output) => {
			expect(workerStream.inputLatency).toBeTypeOf('number')
			expect(workerStream.outputLatency).toBeTypeOf('number')
			responseCounter++
			if (responseCounter === 1) {
				expect(output).toBeInstanceOf(Array)
				expect(output[0]).toEqual(3)
				expect(output[1]).toEqual(1)
			} else if (responseCounter === 2) {
				expect(output).toBeTypeOf('string')
				expect(output).toEqual('4')
			} else if (responseCounter === 3) {
				expect(output).toBeInstanceOf(Array)
				expect(output[0]).toEqual(3)
				expect(output[1]).toEqual(2)
			} else if (responseCounter === 4) {
				expect(output).toBeTypeOf('string')
				expect(output).toEqual('5')
			} else {
				throw new Error('Unexpected response')
			}
		})
		workerStream.onError((error) => {
			throw new Error('Unexpected error')
		})
		expect(() => workerStream.push([1, 2])).toThrow('Not started')
		workerStream.start()
		expect(() => workerStream.onOutput(() => {})).toThrow('Was started')
		expect(() => workerStream.onError(() => {})).toThrow('Was started')
		expect(() => workerStream.start()).toThrow('Was started')
		workerStream.push([1, 2])
		expect(responseCounter).toEqual(0)
		workerStream.push([1, 2])
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(responseCounter).toEqual(4)
		workerStream.stop()
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Was stopped')
		workerStream.stop()
		expect(() => workerStream.push([1, 2])).toThrow('Was stopped')
	})

	test('redirect errors from worker stream\'s `onOutput` handler to `onError` handler', async () => {
		const workerStream = createWorkerStream(env, (emit: Emit<number>) => {
			return (input: number) => {
				// Simply echoes the input back to the main thread.
				emit(input)
			}
		})
		// Add dependencies.
		workerStream.addDependencies(() => [createTestError])
		// Add an error listener that catches an error.
		let thrown
		workerStream.onError((error) => {
			thrown = error
		})
		// Add an output listener that throws an error.
		workerStream.onOutput((output) => {
			throw createTestError()
		})
		workerStream.start()
		workerStream.push(1)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		workerStream.stop()
		expect(thrown).toBeDefined()
		expect((thrown as unknown as TestError).code).toEqual(TEST_ERROR_PROPERTIES.code)
		expect((thrown as unknown as TestError).name).toEqual(TEST_ERROR_PROPERTIES.name)
		expect(thrown as unknown as TestError).toBeInstanceOf(TestError)
	})

	test('not allow changing dependencies of an already-aliased function', async () => {
		// Dependency.
		const c = 1

		// Create a function and assign an alias.

		const workerFn = createWorkerFunction(env, (a: number, b: number) => a + b + c)

		workerFn.addDependencies(() => [c])
		workerFn.alias('sum')

		expect(() => {
			workerFn.alias('a+b')
		}).toThrow('Has alias')

		expect(() => {
			workerFn.addDependencies(() => [
				createTestError,
				TestError,
				TEST_ERROR_PROPERTIES
			])
		}).toThrow('Has alias')

		// Create a function from an alias.

		const workerFn2 = createWorkerFunction(env, 'sum')

		expect(() => {
			workerFn2.alias('a+b')
		}).toThrow('Has alias')

		expect(() => {
			workerFn2.addDependencies(() => [
				createTestError,
				TestError,
				TEST_ERROR_PROPERTIES
			])
		}).toThrow('Has alias')

		// Test that an alias also captures the dependencies.
		expect(await workerFn2.callOnce(1, 2)).toEqual(4)
	})

	test('throw when alias is not found', async () => {
		expect(() => {
			createWorkerFunction(env, 'alias-not-exists')
		}).toThrow('Not found')
	})

	test('clonable dependencies', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => a + b)
		const a = 1
		const b = 2
		const c = true
		const d = new Date()
		const e = [1, 'a']
		const f = { a: 1, b: [2] }
		const g = new Uint8Array(8)
		workerFn.addDependencies(() => [a, b, c, d, e, f, g])
		workerFn.start()
		workerFn.stop()
	})

	test('return error when called', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => {
			return createTestError()
		})
		workerFn.addDependencies(() => [
			createTestError,
			TestError,
			TEST_ERROR_PROPERTIES
		])
		// Start the worker function.
		workerFn.start()
		// Return (not throw) an error from the worker function.
		const error = await workerFn.call(1, 2)
		// Validate that the error properties have been reset.
		expect(TEST_ERROR_PROPERTIES.code).toBeTypeOf('string')
		expect(error.code).toBe(undefined)
		expect(TEST_ERROR_PROPERTIES.name).not.toEqual('Error')
		expect(error.name).toEqual('Error')
		// Validate that the error class was reset to `Error`
		expect(error).toBeInstanceOf(Error)
		expect(error).not.toBeInstanceOf(TestError)
		// Stop the worker function.
		workerFn.stop()
	})

	test('catch error when called', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => {
			throw createTestError()
		})
		workerFn.addDependencies(() => [
			createTestError,
			TestError,
			TEST_ERROR_PROPERTIES
		])
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow(
			expect.objectContaining(TEST_ERROR_PROPERTIES)
		)
		// These two assertions could also be added here somehow:
		// expect(error).toBeInstanceOf(Error)
		// expect(error).not.toBeInstanceOf(TestError)
	})

	test('catch error when called once', async () => {
		const workerFn = createWorkerFunction(env, (a: number, b: number) => {
			throw createTestError()
		})
		workerFn.addDependencies(() => [
			createTestError,
			TestError,
			TEST_ERROR_PROPERTIES
		])
		await expect(async () => await workerFn.callOnce(1, 2)).rejects.toThrow(
			expect.objectContaining(TEST_ERROR_PROPERTIES)
		)
		// These two assertions could also be added here somehow:
		// expect(error).toBeInstanceOf(Error)
		// expect(error).not.toBeInstanceOf(TestError)
	})

	test('catch error when called listened', async () => {
		const workerStream = createWorkerStream(env, (emit: Emit<void>) => {
			return (input: number) => {
				throw createTestError()
			}
		})
		workerStream.addDependencies(() => [
			createTestError,
			TestError,
			TEST_ERROR_PROPERTIES
		])
		workerStream.onOutput((output) => {
			throw new Error('Unexpected response')
		})
		let errorCounter = 0
		// First time adding an error listener — the listener doesn't do anything.
		workerStream.onError((error) => {
			expect(true).toEqual(false)
		})
		// Second time adding an error listener — overwrites the first listener.
		workerStream.onError((error) => {
			expect(error).toEqual(
				expect.objectContaining(TEST_ERROR_PROPERTIES)
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(TestError)
			errorCounter++
		})
		workerStream.start()
		workerStream.push(1)
		expect(errorCounter).toEqual(0)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(errorCounter).toEqual(1)
		workerStream.stop()
	})

	test('add dependencies that\'re "native" global classes or functions', async () => {
		const fn = (length: number) => new Uint8Array(length)
		const workerFn = createWorkerFunction(env, fn)
		const result = await workerFn.callOnce(1)
		expect(result).toBeInstanceOf(Uint8Array)
	})

	test('add dependencies and dependencies of dependencies', async () => {
		const d = 2
		const c = () => d + 1
		const fn = (a: number, b: number) => a + b + c()

		let workerFn = createWorkerFunction(env, fn)
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('c is not defined')

		workerFn = createWorkerFunction(env, fn)
		workerFn.addDependencies(() => [c])
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('d is not defined')

		workerFn = createWorkerFunction(env, fn)
		workerFn.addDependencies(() => [c, d])
		workerFn.start()
		expect(await workerFn.call(1, 2)).toEqual(6)
		workerFn.stop()

		workerFn = createWorkerFunction(env, fn)
		// @ts-expect-error
		expect(() => workerFn.addDependencies([c, d])).toThrow('function')
	})

	test('create transfer list for input arguments (call)', async () => {
		const call = async (getInputTransferList?: (buffer: ArrayBuffer) => Transferable[]) => {
			const workerFn = createWorkerFunction(env, (buffer: ArrayBuffer) => buffer.byteLength)

			const buffer = new ArrayBuffer(1)
			const view = new Uint8Array(buffer)
			view.fill(255)

			if (getInputTransferList) {
				workerFn.inputTransferList(getInputTransferList)
			}

			workerFn.start()

			expect(buffer.byteLength).toEqual(1)
			await workerFn.call(buffer)
			expect(buffer.byteLength).toEqual(getInputTransferList ? 0 : 1)

			workerFn.stop()
		}

		// Without `inputTransferList`
		await call()

		// With `inputTransferList`
		await call((buffer) => [buffer])
	})

	test('create transfer list for output result (call)', async () => {
		const test = async (alias?: string) => {
			let workerFn = createWorkerFunction(env, () => {
				const buffer = new ArrayBuffer(1)
				const view = new Uint8Array(buffer)
				view.fill(255)
				setTimeout(() => {
					if (buffer.byteLength !== 0) {
						throw new Error('Expected output buffer to have been transferred (call)')
					}
				}, 0)
				return buffer
			})

			workerFn.outputTransferList((buffer) => [buffer])

			if (alias) {
				workerFn.alias(alias)
				workerFn = createWorkerFunction(env, alias)
			}

			workerFn.start()

			const buffer = await workerFn.call()
			expect(buffer.byteLength).toEqual(1)

			// Wait for the `setTimeout()` call in the function body to finish.
			await delay(INTER_THREAD_COMMUNICATION_DELAY)

			workerFn.stop()
		}

		// Without alias.
		await test()

		// With alias.
		await test('outputTransferList-call')
	})

	test('streaming function: able to respond before receiving any input data', async () => {
		const workerStream = createWorkerStream(env, (emit: Emit<number>) => {
			emit(1)
			return () => {}
		})

		let result: number | undefined
		workerStream.onOutput((number: number) => {
			result = number
		})

		expect(result).toBeUndefined()
		expect(workerStream.inputLatency).toBeUndefined()
		expect(workerStream.outputLatency).toBeUndefined()

		workerStream.start()
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(result).toEqual(1)
		expect(workerStream.inputLatency).toBeUndefined()
		expect(workerStream.outputLatency).toBeTypeOf('number')
		workerStream.stop()
	})

	test('create transfer list for input arguments (stream)', async () => {
		const test = async (alias?: string, getInputTransferList?: (buffer: ArrayBuffer) => Transferable[]) => {
			let workerStream = createWorkerStream(env, (emit: Emit<ArrayBuffer>) => {
				return (buffer: ArrayBuffer) => {}
			})

			const buffer = new ArrayBuffer(1)
			const view = new Uint8Array(buffer)
			view.fill(255)

			if (getInputTransferList) {
				workerStream.inputTransferList(getInputTransferList)
			}

			if (alias) {
				workerStream.alias(alias)
				workerStream = createWorkerStream(env, alias)
			}

			workerStream.start()

			expect(buffer.byteLength).toEqual(1)
			await workerStream.push(buffer)
			expect(buffer.byteLength).toEqual(getInputTransferList ? 0 : 1)

			workerStream.stop()
		}

		// Without alias. Without `inputTransferList`.
		await test(undefined)

		// Without alias. With `inputTransferList`.
		await test(undefined, (buffer) => [buffer])

		// With alias. Without `inputTransferList`.
		await test('outputTransferList-stream')

		// With alias. With `inputTransferList`.
		await test('outputTransferList-stream', (buffer) => [buffer])
	})


	test('create transfer list for output result (stream)', async () => {
		const workerStream = createWorkerStream(env, (emit: Emit<ArrayBuffer>) => {
			return async () => {
				const buffer = new ArrayBuffer(1)
				const view = new Uint8Array(buffer)
				view.fill(255)
				emit(buffer)
				setTimeout(() => {
					if (buffer.byteLength !== 0) {
						throw new Error('Expected output buffer to have been transferred (stream)')
					}
				}, 0)
			}
		})

		let outputReceived = false

		workerStream.onOutput((buffer: ArrayBuffer) => {
			outputReceived = true
			expect(buffer.byteLength).toEqual(1)
		})

		workerStream.outputTransferList((buffer) => [buffer])

		workerStream.start()

		await workerStream.push(1)
		expect(outputReceived).toEqual(false)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(outputReceived).toEqual(true)

		workerStream.stop()
	})

	test('cache (non-streaming function)', async () => {
		const workerFn_ = createWorkerFunction(env, (a: number, b: number) => a + b)
		workerFn_.alias('fn1')

		expect(() => {
			createWorkerFunction(env, 'fn2')
		}).toThrow('Not found')

		const workerFn = createWorkerFunction(env, 'fn1')
		workerFn.start()
		expect(await workerFn.call(1, 2)).toEqual(3)
		workerFn.stop()

		const workerFn2 = createWorkerFunction(env, 'fn1')
		workerFn2.start()
		expect(await workerFn2.call(1, 2)).toEqual(3)
		workerFn2.stop()
	})

	test('cache (streaming function)', async () => {
		const workerFn_ = createWorkerStream(env, (emit: Emit<number>) => {
			return (number: number) => {
				emit(number*number)
			}
		})
		workerFn_.alias('fn1')

		expect(() => {
			createWorkerStream(env, 'fn2')
		}).toThrow('Not found')

		const workerStream = createWorkerStream<number, number>(env, 'fn1')
		let output: number | undefined
		workerStream.onOutput((result: number) => {
			output = result
		})
		workerStream.start()
		expect(output).toBeUndefined()
		workerStream.push(2)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(output).toEqual(4)
		workerStream.stop()

		const workerStream2 = createWorkerStream<number, number>(env, 'fn1')
		let output2: number | undefined
		workerStream2.onOutput((result: number) => {
			output2 = result
		})
		workerStream2.start()
		workerStream2.push(3)
		expect(output2).toBeUndefined()
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(output2).toEqual(9)
		workerStream2.stop()
	})
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

const TEST_ERROR_PROPERTIES = {
	message: 'This is a test',
	name: 'TestError',
	code: 'TEST_CODE'
}

function createTestError() {
	return new TestError(TEST_ERROR_PROPERTIES.message)
}

class TestError extends Error {
	code: string

	constructor(message: string) {
		super(message)
		this.name = TEST_ERROR_PROPERTIES.name
		this.code = TEST_ERROR_PROPERTIES.code
	}
}