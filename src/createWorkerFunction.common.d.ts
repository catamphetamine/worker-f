export type GetDependencies = () => any[]

export interface EnvironmentWorker {
	push(data: any, transferList?: readonly Transferable[]): void;
	stop(): void;
}

export interface UniversalWorker {
	start(
		arrayOfGetDependenciesFunctions: GetDependencies[],
		dependenciesTransferList?: Transferable[]
	): void;
	stop(): void;
	push(data: unknown, transferList?: Transferable[]): void;
}

export type CreateWorkerInEnvironment = <Output>(
	javascriptCode: string,
	getFromCache: () => any | undefined,
	setInCache: (value: any) => void,
	onError: (error: unknown) => void,
	onOutput: (output: Output) => void
) => EnvironmentWorker
