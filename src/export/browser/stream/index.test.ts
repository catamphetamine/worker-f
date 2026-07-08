import { test } from 'tape'

import createStreamingWorkerFunction from './index.ts'

test('`/browser/stream` export', async (t) => {
	t.equal(typeof createStreamingWorkerFunction, 'function')
})