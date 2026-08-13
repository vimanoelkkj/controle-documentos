export const API_SESSION_EXPIRED_EVENT = "api:session-expired";

type ApiErrorPayload = {
  erro?: string;
  codigo?: string;
  temporario?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly temporary: boolean;
  readonly payload: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      temporary?: boolean;
      payload?: unknown;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.temporary = Boolean(options.temporary);
    this.payload = options.payload;
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function defaultErrorMessage(status: number) {
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status === 403) return "Você não possui permissão para esta operação.";
  if (status === 404) return "O recurso solicitado não foi encontrado.";
  if (status >= 500) return "O serviço está temporariamente indisponível.";
  return "Não foi possível concluir a solicitação.";
}

export async function apiRequest<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;

  if (hasBody && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(input, {
      credentials: "same-origin",
      ...init,
      headers,
    });
  } catch (cause) {
    throw new ApiError("Não foi possível acessar o servidor.", {
      status: 0,
      temporary: true,
      payload: cause,
    });
  }

  const payload = await readResponseBody(response);

  if (!response.ok) {
    const errorPayload = isApiErrorPayload(payload) ? payload : undefined;

    if (response.status === 401) {
      window.dispatchEvent(new Event(API_SESSION_EXPIRED_EVENT));
    }

    throw new ApiError(
      errorPayload?.erro || defaultErrorMessage(response.status),
      {
        status: response.status,
        code: errorPayload?.codigo,
        temporary: errorPayload?.temporario,
        payload,
      },
    );
  }

  return payload as T;
}

export const api = {
  get<T>(path: string, init: RequestInit = {}) {
    return apiRequest<T>(path, { ...init, method: "GET" });
  },
  post<T>(path: string, body?: unknown, init: RequestInit = {}) {
    return apiRequest<T>(path, {
      ...init,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body?: unknown, init: RequestInit = {}) {
    return apiRequest<T>(path, {
      ...init,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string, body?: unknown, init: RequestInit = {}) {
    return apiRequest<T>(path, {
      ...init,
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
};
