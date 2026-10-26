import { test, type Test } from 'tape'

import createWorkerStream, { type Emit } from './index.ts'

const INTER_THREAD_COMMUNICATION_DELAY = 150

test('`/node/stream` export', async (t) => {
	t.equal(typeof createWorkerStream, 'function')
})

test('`/node/stream` export: create and call a function', async (t) => {
	const workerStream = createWorkerStream((emit: Emit<number>) => {
		return (input: number) => {
			emit(input)
		}
	})
	await throwsAsync(t, async () => await workerStream.push(1), 'Not started')
	let output: number | undefined
	workerStream.onOutput((output_) => {
		output = output_
	})
	workerStream.start()
	t.throws(() => workerStream.start(), 'Was started')
	await workerStream.push(1)
	t.equal(output, undefined)
	await delay(INTER_THREAD_COMMUNICATION_DELAY)
	t.equal(output, 1)
	workerStream.stop()
	workerStream.stop()
	t.throws(() => workerStream.push(1), 'Was stopped')
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