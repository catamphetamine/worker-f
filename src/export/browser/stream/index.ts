export { default as default } from './createWorkerStreamInBrowser.ts'

export type {
	WorkerStream,
	// (deprecated)
	// The legacy name for `WorkerStream` was `StreamingWorkerFunction`.
	StreamingWorkerFunction,
	Emit,
	// (deprecated)
	// The legacy name for `Emit` was `Send`.
	Send
} from '../../../createWorkerStream.ts'