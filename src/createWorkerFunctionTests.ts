import { expect, test } from 'vitest'

import type { CreateWorkerInEnvironment } from './createWorker.ts'
import createStreamingWorkerFunction, { type Send } from './createStreamingWorkerFunction.ts'
import createNonStreamingWorkerFunction from './createWorkerFunction.ts'

const INTER_THREAD_COMMUNICATION_DELAY = 150

export default function runTests(env: CreateWorkerInEnvironment) {
	test('create and call a function', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b)
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
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b)
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

	test('create and listen to a function', async () => {
		const workerFn = createStreamingWorkerFunction(env, (send: Send<[number, number] | string>) => {
			let count = 0
			// An streaming worker function could receive multiple arguments from the main thread.
			return ([a, b]: [number, number]) => {
				count++
				// An streaming worker function could send multiple arguments to the main thread.
				send([a + b, count])
				send(String(a + b + count))
			}
		})
		expect(workerFn.inputLatency).toBeUndefined()
		expect(workerFn.outputLatency).toBeUndefined()
		let responseCounter = 0
		workerFn.onOutput((output) => {
			expect(workerFn.inputLatency).toBeTypeOf('number')
			expect(workerFn.outputLatency).toBeTypeOf('number')
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
		workerFn.onError((error) => {
			throw new Error('Unexpected error')
		})
		expect(() => workerFn.send([1, 2])).toThrow('Not started')
		workerFn.start()
		expect(() => workerFn.onOutput(() => {})).toThrow('Was started')
		expect(() => workerFn.onError(() => {})).toThrow('Was started')
		expect(() => workerFn.start()).toThrow('Was started')
		workerFn.send([1, 2])
		expect(responseCounter).toEqual(0)
		workerFn.send([1, 2])
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(responseCounter).toEqual(4)
		workerFn.stop()
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Was stopped')
		workerFn.stop()
		expect(() => workerFn.send([1, 2])).toThrow('Was stopped')
	})

	test('not allow changing dependencies of an already-aliased function', async () => {
		// Dependency.
		const c = 1

		// Create a function and assign an alias.

		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b + c)

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

		const workerFn2 = createNonStreamingWorkerFunction(env, 'sum')

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
			createNonStreamingWorkerFunction(env, 'alias-not-exists')
		}).toThrow('Not found')
	})

	test('return error when called', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => {
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
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => {
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
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => {
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
		const workerFn = createStreamingWorkerFunction(env, (send: Send<void>) => {
			return (input: number) => {
				throw createTestError()
			}
		})
		workerFn.addDependencies(() => [
			createTestError,
			TestError,
			TEST_ERROR_PROPERTIES
		])
		workerFn.onOutput((output) => {
			throw new Error('Unexpected response')
		})
		let errorCounter = 0
		workerFn.onError((error) => {
			expect(error).toEqual(
				expect.objectContaining(TEST_ERROR_PROPERTIES)
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(TestError)
			errorCounter++
		})
		workerFn.start()
		workerFn.send(1)
		expect(errorCounter).toEqual(0)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(errorCounter).toEqual(1)
		workerFn.stop()
	})

	test('add dependencies that\'re "native" global classes or functions', async () => {
		const fn = (length: number) => new Uint8Array(length)
		const workerFn = createNonStreamingWorkerFunction(env, fn)
		const result = await workerFn.callOnce(1)
		expect(result).toBeInstanceOf(Uint8Array)
	})

	test('add dependencies and dependencies of dependencies', async () => {
		const d = 2
		const c = () => d + 1
		const fn = (a: number, b: number) => a + b + c()

		let workerFn = createNonStreamingWorkerFunction(env, fn)
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('c is not defined')

		workerFn = createNonStreamingWorkerFunction(env, fn)
		workerFn.addDependencies(() => [c])
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('d is not defined')

		workerFn = createNonStreamingWorkerFunction(env, fn)
		workerFn.addDependencies(() => [c, d])
		workerFn.start()
		expect(await workerFn.call(1, 2)).toEqual(6)
		workerFn.stop()

		workerFn = createNonStreamingWorkerFunction(env, fn)
		// @ts-expect-error
		expect(() => workerFn.addDependencies([c, d])).toThrow('function')
	})

	test('create transfer list for input arguments (call)', async () => {
		const call = async (getInputTransferList?: (buffer: ArrayBuffer) => Transferable[]) => {
			const workerFn = createNonStreamingWorkerFunction(env, (buffer: ArrayBuffer) => buffer.byteLength)

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
			let workerFn = createNonStreamingWorkerFunction(env, () => {
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
				workerFn = createNonStreamingWorkerFunction(env, alias)
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
		const workerFn = createStreamingWorkerFunction(env, (send: Send<number>) => {
			send(1)
			return () => {}
		})

		let result: number | undefined
		workerFn.onOutput((number: number) => {
			result = number
		})

		expect(result).toBeUndefined()
		expect(workerFn.inputLatency).toBeUndefined()
		expect(workerFn.outputLatency).toBeUndefined()

		workerFn.start()
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(result).toEqual(1)
		expect(workerFn.inputLatency).toBeUndefined()
		expect(workerFn.outputLatency).toBeTypeOf('number')
		workerFn.stop()
	})

	test('create transfer list for input arguments (stream)', async () => {
		const test = async (alias?: string, getInputTransferList?: (buffer: ArrayBuffer) => Transferable[]) => {
			let workerFn = createStreamingWorkerFunction(env, (send: Send<ArrayBuffer>) => {
				return (buffer: ArrayBuffer) => {}
			})

			const buffer = new ArrayBuffer(1)
			const view = new Uint8Array(buffer)
			view.fill(255)

			if (getInputTransferList) {
				workerFn.inputTransferList(getInputTransferList)
			}

			if (alias) {
				workerFn.alias(alias)
				workerFn = createStreamingWorkerFunction(env, alias)
			}

			workerFn.start()

			expect(buffer.byteLength).toEqual(1)
			await workerFn.send(buffer)
			expect(buffer.byteLength).toEqual(getInputTransferList ? 0 : 1)

			workerFn.stop()
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
		const workerFn = createStreamingWorkerFunction(env, (send: Send<ArrayBuffer>) => {
			return async () => {
				const buffer = new ArrayBuffer(1)
				const view = new Uint8Array(buffer)
				view.fill(255)
				send(buffer)
				setTimeout(() => {
					if (buffer.byteLength !== 0) {
						throw new Error('Expected output buffer to have been transferred (stream)')
					}
				}, 0)
			}
		})

		let outputReceived = false

		workerFn.onOutput((buffer: ArrayBuffer) => {
			outputReceived = true
			expect(buffer.byteLength).toEqual(1)
		})

		workerFn.outputTransferList((buffer) => [buffer])

		workerFn.start()

		await workerFn.send(1)
		expect(outputReceived).toEqual(false)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(outputReceived).toEqual(true)

		workerFn.stop()
	})

	test('cache (non-streaming function)', async () => {
		const workerFn_ = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b)
		workerFn_.alias('fn1')

		expect(() => {
			createNonStreamingWorkerFunction(env, 'fn2')
		}).toThrow('Not found')

		const workerFn = createNonStreamingWorkerFunction(env, 'fn1')
		workerFn.start()
		expect(await workerFn.call(1, 2)).toEqual(3)
		workerFn.stop()

		const workerFn2 = createNonStreamingWorkerFunction(env, 'fn1')
		workerFn2.start()
		expect(await workerFn2.call(1, 2)).toEqual(3)
		workerFn2.stop()
	})

	test('cache (streaming function)', async () => {
		const workerFn_ = createStreamingWorkerFunction(env, (send: Send<number>) => {
			return (number: number) => {
				send(number*number)
			}
		})
		workerFn_.alias('fn1')

		expect(() => {
			createStreamingWorkerFunction(env, 'fn2')
		}).toThrow('Not found')

		const workerFn = createStreamingWorkerFunction<number, number>(env, 'fn1')
		let output: number | undefined
		workerFn.onOutput((result: number) => {
			output = result
		})
		workerFn.start()
		expect(output).toBeUndefined()
		workerFn.send(2)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(output).toEqual(4)
		workerFn.stop()

		const workerFn2 = createStreamingWorkerFunction<number, number>(env, 'fn1')
		let output2: number | undefined
		workerFn2.onOutput((result: number) => {
			output2 = result
		})
		workerFn2.start()
		workerFn2.send(3)
		expect(output2).toBeUndefined()
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(output2).toEqual(9)
		workerFn2.stop()
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