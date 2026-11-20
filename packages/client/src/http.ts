/**
 * Archer Harness — HTTP 基础
 */

/** 服务端返回非 2xx 时抛出 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export interface HttpOptions {
  /** 服务地址；浏览器同源场景可传空字符串 */
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (this.token) {
      headers.set('authorization', `Bearer ${this.token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let message = `请求失败（HTTP ${response.status}）`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as { error?: string; code?: string };
        if (body.error) message = body.error;
        if (body.code) code = body.code;
      } catch {
        // 非 JSON 错误体，保留默认信息
      }
      throw new ApiError(message, response.status, code);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  /** 打开 SSE 流；调用方负责读取 response.body */
  async openStream(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'text/event-stream');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    return this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
