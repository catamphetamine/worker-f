import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'

export default [
  {
    input: './lib/export/browser/createWorkerFunctionInBrowser.js',
    plugins: [
      json(),
      terser(),
      nodeResolve({
        browser: true
      }),
      commonjs()
    ],
    output: {
      format: 'umd',
      name: 'workerFunction',
      file: 'bundle/worker-f.min.js',
      sourcemap: true
    }
  },

  {
    input: './lib/export/browser/stream/createStreamingWorkerFunctionInBrowser.js',
    plugins: [
      json(),
      terser(),
      nodeResolve({
        browser: true
      }),
      commonjs()
    ],
    output: {
      format: 'umd',
      name: 'workerFunction',
      file: 'bundle/worker-f-stream.min.js',
      sourcemap: true
    }
  }
]