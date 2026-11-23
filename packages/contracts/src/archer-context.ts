/** 应用级依赖容器协议；不暴露第三方 IoC 类型或底层容器。 */
import type { Camp, CapabilityRef } from './provider.js';

declare const serviceType: unique symbol;

/** Token 按 symbol 身份区分；类型标记避免不同服务类型互换。 */
export interface ServiceToken<T> {
  readonly key: symbol;
  readonly label: string;
  readonly [serviceType]?: (value: T) => T;
}

export interface ArcherContext {
  readonly signal: AbortSignal;
  resolve<T>(token: ServiceToken<T>): T;
  /** 停止解析并逆序释放已构造的 owned 服务；重复调用共享同一结果。 */
  dispose(): Promise<void>;
}

export interface ServiceFactoryOptions<T> {
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface ArcherContextBuilder {
  /** 值是借用对象，容器不会调用它的 close 或 dispose。 */
  provideValue<T>(token: ServiceToken<T>, value: T): this;
  /** 工厂为惰性应用级单例；异步初始化通过 Dependency.open 显式完成。 */
  provideFactory<T>(token: ServiceToken<T>, factory: (context: ArcherContext) => T, options?: ServiceFactoryOptions<T>): this;
  /** 构建后禁止继续注册，也不能重复 build。 */
  build(): ArcherContext;
}

/** 标准应用依赖的装配配置；函数与依赖句柄只存在于进程内。 */
export interface ArcherContextOptions {
  readonly camp: Camp;
  readonly journal?: CapabilityRef;
  readonly inference?: CapabilityRef;
  readonly clock?: () => number;
  readonly configure?: (builder: ArcherContextBuilder) => void;
}
