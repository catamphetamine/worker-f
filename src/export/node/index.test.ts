import { test, type Test } from 'tape'

import createWorkerFunction from './index.ts'

test('`/node` export', async (t) => {
	t.equal(typeof createWorkerFunction, 'function')
})

test('`/node` export: create and call a function', async (t) => {
	const workerFn = createWorkerFunction((a: number, b: number) => a + b)
	await throwsAsync(t, async () => await workerFn.call(1, 2), 'Not started')
	workerFn.start()
	t.throws(() => workerFn.start(), 'Was started')
	t.equal(await workerFn.call(1, 2), 3)
	workerFn.stop()
	workerFn.stop()
	await throwsAsync(t, async () => await workerFn.call(1, 2), 'Was stopped')
})

async function throwsAsync(t: Test, func: Function, message: string) {
	try {
		await func()
		t.fail('Should have thrown')
	} catch (error) {
		t.equal((error as Error).message.includes(message), true)
	}
}