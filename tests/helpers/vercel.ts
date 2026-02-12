type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export interface MockVercelResponse {
  statusCode: number;
  body: JsonValue | null;
  status: (code: number) => MockVercelResponse;
  json: (payload: JsonValue) => MockVercelResponse;
}

export function createMockVercelResponse(): MockVercelResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: JsonValue) {
      this.body = payload;
      return this;
    },
  };
}

export function toVercelResponse(response: MockVercelResponse): import('@vercel/node').VercelResponse {
  return response as unknown as import('@vercel/node').VercelResponse;
}
