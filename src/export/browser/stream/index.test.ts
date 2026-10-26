import { test } from 'tape'

import createWorkerStream from './index.ts'

test('`/browser/stream` export', async (t) => {
	t.equal(typeof createWorkerStream, 'function')
})