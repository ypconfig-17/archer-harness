/** 驱动同步 Generator；异步操作由 Handler 解释，流程异常直接向调用方传播。 */
export async function run<E, T, R>(
  program: Generator<E, T, R>,
  handler: (effect: E) => R | PromiseLike<R>,
): Promise<T> {
  let step = program.next();
  while (!step.done) {
    let result: R;
    try {
      result = await handler(step.value);
    } catch (error: unknown) {
      step = program.throw(error);
      continue;
    }
    step = program.next(result);
  }
  return step.value;
}

/** 用 yield* 为单个执行意图声明返回值类型；运行时结果校验由 Handler 负责。 */
export function* perform<T, E = unknown>(effect: E): Generator<E, T, unknown> {
  return (yield effect) as T;
}
