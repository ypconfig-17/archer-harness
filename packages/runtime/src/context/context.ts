/** Awilix 仅用于内部注册与单例缓存；公共协议不暴露其类型和逃生接口。 */
import { asFunction, asValue, createContainer } from 'awilix';
import { ArcherError } from '@archer/contracts';
import type { ArcherContext, ArcherContextBuilder, ServiceFactoryOptions, ServiceToken } from '@archer/contracts';

export function createServiceToken<T>(label: string): ServiceToken<T> {
  if (!label.trim()) throw new ArcherError('INVALID_ARGUMENT', '服务 Token 标签不能为空');
  return Object.freeze({ key: Symbol(label), label });
}

/** 只支持应用级注册，不自动加载模块或创建 Agent/Turn 子容器。 */
export function createArcherContextBuilder(options: { signal?: AbortSignal } = {}): ArcherContextBuilder {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const container = createContainer({ strict: true });
  const registered = new Set<symbol>();
  const registrations: Array<(context: ArcherContext) => void> = [];
  const disposers: Array<() => void | Promise<void>> = [];
  let built = false;

  const checkRegistration = <T>(token: ServiceToken<T>): void => {
    if (built) throw new ArcherError('CONFLICT', 'Context 构建后不能再注册服务');
    if (!token || typeof token.key !== 'symbol' || typeof token.label !== 'string' || !token.label.trim()) {
      throw new ArcherError('INVALID_ARGUMENT', '服务 Token 不合法');
    }
    if (registered.has(token.key)) throw new ArcherError('CONFLICT', `服务已注册：${token.label}`);
    registered.add(token.key);
  };

  const builder: ArcherContextBuilder = {
    provideValue<T>(token: ServiceToken<T>, value: T) {
      checkRegistration(token);
      registrations.push(() => { container.register(token.key, asValue(value)); });
      return this;
    },
    provideFactory<T>(token: ServiceToken<T>, factory: (context: ArcherContext) => T, factoryOptions?: ServiceFactoryOptions<T>) {
      if (typeof factory !== 'function') throw new ArcherError('INVALID_ARGUMENT', '服务工厂必须是函数');
      if (factoryOptions?.dispose !== undefined && typeof factoryOptions.dispose !== 'function') {
        throw new ArcherError('INVALID_ARGUMENT', '服务释放器必须是函数');
      }
      checkRegistration(token);
      const dispose = factoryOptions?.dispose;
      registrations.push(context => {
        container.register(token.key, asFunction(() => {
          const value = factory(context);
          if (dispose) disposers.push(() => dispose(value));
          return value;
        }).singleton());
      });
      return this;
    },
    build(): ArcherContext {
      if (built) throw new ArcherError('CONFLICT', 'ContextBuilder 只能构建一次');
      built = true;
      let state: 'active' | 'disposing' | 'disposed' = 'active';
      let disposal: Promise<void> | undefined;
      const resolving: Array<{ key: symbol; label: string }> = [];

      const context: ArcherContext = Object.freeze({
        signal,
        resolve<T>(token: ServiceToken<T>): T {
          if (state !== 'active') throw new ArcherError('CONFLICT', 'Context 已停止解析服务');
          if (signal.aborted) throw new ArcherError('ABORTED', 'Context 已取消');
          if (!token || !registered.has(token.key)) throw new ArcherError('NOT_FOUND', `服务未注册：${token?.label ?? 'unknown'}`);
          if (resolving.some(entry => entry.key === token.key)) {
            throw new ArcherError('CONFLICT', `服务循环依赖：${[...resolving.map(entry => entry.label), token.label].join(' -> ')}`);
          }
          resolving.push(token);
          try {
            return container.resolve<T>(token.key);
          } catch (error) {
            if (error instanceof ArcherError) throw error;
            // 第三方错误类型和调用栈不进入公共协议。
            throw new ArcherError('ARCHER_FAILED', `构造服务失败：${token.label}`);
          } finally {
            resolving.pop();
          }
        },
        dispose(): Promise<void> {
          if (disposal) return disposal;
          state = 'disposing';
          disposal = Promise.resolve().then(async () => {
            const failures: string[] = [];
            // Awilix 的默认清理并发执行；这里按实际构造顺序逆序等待，保护依赖关系。
            for (const dispose of disposers.splice(0).reverse()) {
              try { await dispose(); }
              catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
            }
            try { await container.dispose(); }
            catch { failures.push('内部容器释放失败'); }
            state = 'disposed';
            if (failures.length) throw new ArcherError('INTERNAL', 'Context 资源释放失败', { failures });
          });
          // 先建立幂等结果，避免 abort 监听器重入 dispose 时重复启动清理。
          controller.abort();
          return disposal;
        },
      });
      for (const register of registrations) register(context);
      registrations.length = 0;
      return context;
    },
  };
  return builder;
}
