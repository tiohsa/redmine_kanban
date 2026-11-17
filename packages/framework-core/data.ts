export interface QueryDescriptor<TParams, TResult> {
  readonly name: string;
  readonly run: (params: TParams) => Promise<TResult> | TResult;
}

export function defineQuery<TParams, TResult>(
  descriptor: QueryDescriptor<TParams, TResult>,
): QueryDescriptor<TParams, TResult> {
  return descriptor;
}

export async function executeQuery<TParams, TResult>(
  descriptor: QueryDescriptor<TParams, TResult>,
  params: TParams,
): Promise<TResult> {
  return await descriptor.run(params);
}
