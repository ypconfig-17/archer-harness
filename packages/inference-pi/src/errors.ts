/**
 * Archer Harness — pi-ai 推理端口错误
 *
 * 错误码描述失败发生在哪一层：配置、路由/模型选择、凭据、provider 请求
 * 或取消。错误消息只携带可公开的诊断信息，凭据值在抛出前必须脱敏。
 */

export type PiInferenceErrorCode =
  | 'CONFIG_INVALID'
  | 'PROVIDER_REQUIRED'
  | 'UNKNOWN_PROVIDER'
  | 'MODEL_REQUIRED'
  | 'UNKNOWN_MODEL'
  | 'MISSING_CREDENTIAL'
  | 'PROVIDER_ERROR'
  | 'ABORTED';

export class PiInferenceError extends Error {
  readonly code: PiInferenceErrorCode;

  constructor(code: PiInferenceErrorCode, message: string) {
    super(message);
    this.name = 'PiInferenceError';
    this.code = code;
  }
}
