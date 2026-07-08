import { expect, test } from 'vitest'

import createStreamingWorkerFunction from './createStreamingWorkerFunction.ts'
import createNonStreamingWorkerFunction from './createWorkerFunction.ts'

import type { CreateWorkerInEnvironment } from './createWorkerFunction.common.d.ts'
import type { Send } from './exportTypes.d.ts'

const INTER_THREAD_COMMUNICATION_DELAY = 100
const TESTING_ERROR_MESSAGE = 'This is a test'

export default function runTests(env: CreateWorkerInEnvironment) {
	test('create and call a function', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b)
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Not started')
		workerFn.start()
		expect(() => workerFn.start()).toThrow('Already started')
		expect(await workerFn.call(1, 2)).toEqual(3)
		workerFn.stop()
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Already stopped')
		workerFn.stop()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Already stopped')
	})

	test('create and call a function once', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => a + b)
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Not started')
		expect(await workerFn.callOnce(1, 2)).toEqual(3)
		expect(() => workerFn.start()).toThrow('Already stopped')
		await expect(async () => await workerFn.callOnce(1, 2)).rejects.toThrow('Already stopped')
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow('Already stopped')
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Already stopped')
		workerFn.stop()
	})

	test('create and listen to a function', async () => {
		const workerFn = createStreamingWorkerFunction(env, (send: Send<number>) => {
			let count = 0
			return ([a, b]: [number, number]) => {
				send(a + b + count)
				send(a - b + count)
				count++
			}
		})
		let responseCounter = 0
		workerFn.onOutput((output) => {
			responseCounter++
			if (responseCounter === 1) {
				expect(output === 3)
			} else if (responseCounter === 2) {
				expect(output === -1)
			} else if (responseCounter === 3) {
				expect(output === 4)
			} else if (responseCounter === 4) {
				expect(output === 0)
			} else {
				throw new Error('Unexpected repsonse')
			}
		})
		workerFn.onError((error) => {
			throw new Error('Unexpected error')
		})
		expect(() => workerFn.send([1, 2])).toThrow('Not started')
		workerFn.start()
		expect(() => workerFn.onOutput(() => {})).toThrow('Already started')
		expect(() => workerFn.onError(() => {})).toThrow('Already started')
		expect(() => workerFn.start()).toThrow('Already started')
		workerFn.send([1, 2])
		expect(responseCounter).toEqual(0)
		workerFn.send([1, 2])
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(responseCounter).toEqual(4)
		workerFn.stop()
		// Stopping a function multiple times doesn't throw any error.
		// expect(() => workerFn.stop()).toThrow('Already stopped')
		workerFn.stop()
		expect(() => workerFn.send([1, 2])).toThrow('Already stopped')
	})

	test('catch error when called', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => {
			throw new Error(TESTING_ERROR_MESSAGE)
		})
		workerFn.addDependencies(() => [TESTING_ERROR_MESSAGE])
		workerFn.start()
		await expect(async () => await workerFn.call(1, 2)).rejects.toThrow(TESTING_ERROR_MESSAGE)
	})

	test('catch error when called once', async () => {
		const workerFn = createNonStreamingWorkerFunction(env, (a: number, b: number) => {
			throw new Error(TESTING_ERROR_MESSAGE)
		})
		workerFn.addDependencies(() => [TESTING_ERROR_MESSAGE])
		await expect(async () => await workerFn.callOnce(1, 2)).rejects.toThrow(TESTING_ERROR_MESSAGE)
	})

	test('catch error when called listened', async () => {
		const workerFn = createStreamingWorkerFunction(env, (send: Send<void>) => {
			return (input: number) => {
				throw new Error(TESTING_ERROR_MESSAGE)
			}
		})
		workerFn.addDependencies(() => [TESTING_ERROR_MESSAGE])
		workerFn.onOutput((output) => {
			throw new Error('Unexpected repsonse')
		})
		let errorCounter = 0
		workerFn.onError((error) => {
			errorCounter++
		})
		workerFn.start()
		workerFn.send(1)
		expect(errorCounter).toEqual(0)
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(errorCounter).toEqual(1)
		workerFn.stop()
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
		const workerFn = createNonStreamingWorkerFunction(env, () => {
			const buffer = new ArrayBuffer(1)
			const view = new Uint8Array(buffer)
			view.fill(255)
			setTimeout(() => {
				if (buffer.byteLength !== 0) {
					throw new Error('Expected buffer to have been transferred (call)')
				}
			}, 0)
			return buffer
		})

		workerFn.outputTransferList((buffer) => [buffer])

		workerFn.start()

		const buffer = await workerFn.call()
		expect(buffer.byteLength).toEqual(1)

		// Wait for the `setTimeout()` call in the function body to finish.
		await delay(INTER_THREAD_COMMUNICATION_DELAY)

		workerFn.stop()
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

		workerFn.start()
		await delay(INTER_THREAD_COMMUNICATION_DELAY)
		expect(result).toEqual(1)
		workerFn.stop()
	})

	test('create transfer list for input arguments (stream)', async () => {
		const call = async (getInputTransferList?: (buffer: ArrayBuffer) => Transferable[]) => {
			const workerFn = createStreamingWorkerFunction(env, (send: Send<ArrayBuffer>) => {
				return (buffer: ArrayBuffer) => {}
			})

			const buffer = new ArrayBuffer(1)
			const view = new Uint8Array(buffer)
			view.fill(255)

			if (getInputTransferList) {
				workerFn.inputTransferList(getInputTransferList)
			}

			workerFn.start()

			expect(buffer.byteLength).toEqual(1)
			await workerFn.send(buffer)
			expect(buffer.byteLength).toEqual(getInputTransferList ? 0 : 1)

			workerFn.stop()
		}

		// Without `inputTransferList`
		await call()

		// With `inputTransferList`
		await call((buffer) => [buffer])
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
						throw new Error('Expected buffer to have been transferred (stream)')
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
		}).toThrow('Function not provided')

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
		}).toThrow('Function not provided')

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