import { test, type Test } from 'tape'

import createStreamingWorkerFunction, { type Send } from './index.ts'

const INTER_THREAD_COMMUNICATION_DELAY = 150

test('`/node/stream` export', async (t) => {
	t.equal(typeof createStreamingWorkerFunction, 'function')
})

test('`/node/stream` export: create and call a function', async (t) => {
	const workerFn = createStreamingWorkerFunction((send: Send<number>) => {
		return (input: number) => {
			send(input)
		}
	})
	await throwsAsync(t, async () => await workerFn.send(1), 'Not started')
	let output: number | undefined
	workerFn.onOutput((output_) => {
		output = output_
	})
	workerFn.start()
	t.throws(() => workerFn.start(), 'Was started')
	await workerFn.send(1)
	t.equal(output, undefined)
	await delay(INTER_THREAD_COMMUNICATION_DELAY)
	t.equal(output, 1)
	workerFn.stop()
	workerFn.stop()
	t.throws(() => workerFn.send(1), 'Was stopped')
})

async function throwsAsync(t: Test, func: Function, message: string) {
	try {
		await func()
		t.fail('Should have thrown')
	} catch (error) {
		t.equal((error as Error).message.includes(message), true)
	}
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}