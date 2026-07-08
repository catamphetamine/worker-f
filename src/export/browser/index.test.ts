import { test } from 'tape'

import createWorkerFunction from './index.ts'

test('`/browser` export', async (t) => {
	t.equal(typeof createWorkerFunction, 'function')
})