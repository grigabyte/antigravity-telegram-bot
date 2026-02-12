export interface FetchCall {
  url: string;
  init?: RequestInit;
}

export type FetchResponder = (url: string, init?: RequestInit) => Response | Promise<Response>;

export interface FetchMockController {
  calls: FetchCall[];
  restore: () => void;
}

function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function installFetchMock(responder: FetchResponder): FetchMockController {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrlString(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

export function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(payload: string, status: number = 200): Response {
  return new Response(payload, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

export function parseJsonBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== 'string') {
    return null;
  }

  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}
