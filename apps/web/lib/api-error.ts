const messages: Record<number, string> = {
  400: 'Проверьте введённые данные и исправьте ошибки.',
  401: 'Сессия завершена. Войдите повторно.',
  403: 'Недостаточно прав для этой операции.',
  404: 'Объект не найден. Возможно, он был удалён.',
  409: 'Возник конфликт изменений. Проверьте актуальные данные перед повтором.',
  422: 'Проверьте введённые данные и исправьте ошибки.',
  429: 'Слишком много запросов. Подождите и повторите попытку.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly retryAt: number | null;
  readonly fields: Record<string, string>;

  constructor(
    message: string,
    status: number,
    retryAt: number | null = null,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAt = retryAt;
    this.fields = fields;
  }
}

export function retryDeadline(value: string | null, now = Date.now()) {
  if (!value) return null;
  const deadline = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isSafeInteger(deadline) && deadline > now ? deadline : null;
}

export function isRetryPending(deadline: number | undefined) {
  return deadline !== undefined && deadline > Date.now();
}

export async function apiError(
  response: Response,
  fallback: string,
  fieldNames: Record<string, string> = {},
): Promise<ApiError> {
  const { status } = response;
  const fields: Record<string, string> = {};
  if ((status === 400 || status === 422) && Object.keys(fieldNames).length) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body ? body.message : null;
    const entries = Array.isArray(message) ? message : [message];
    for (const entry of entries) {
      if (typeof entry !== 'string') continue;
      // Nest's validation errors use paths such as items.0.quantity.
      const path = entry.match(/^[\w.]+(?=\s|$)/)?.[0];
      if (!path) continue;
      const label = Object.hasOwn(fieldNames, path) ? fieldNames[path] : undefined;
      if (label) fields[path] = `Проверьте поле «${label}».`;
    }
  }
  const retryAt = status === 429 ? retryDeadline(response.headers.get('Retry-After')) : null;
  return new ApiError(messages[status] ?? (status >= 500 ? 'Сервис временно недоступен. Повторите попытку позже.' : fallback),
    status, retryAt, fields);
}

export class ApiConnectionError extends Error {
  readonly kind: 'offline' | 'timeout' | 'network';

  constructor(kind: ApiConnectionError['kind']) {
    super({
      offline: 'Нет подключения к сети. Подключитесь и повторите попытку.',
      timeout: 'Сервер не ответил вовремя.',
      network: 'Не удалось связаться с сервером. Проверьте подключение.',
    }[kind]);
    this.name = 'ApiConnectionError';
    this.kind = kind;
  }
}

export function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof ApiConnectionError ? error.message : fallback;
}

export function apiProblem(error: unknown, fallback: string) {
  return error instanceof ApiError ? error : apiMessage(error, fallback);
}

export function couldHaveSaved(error: unknown) {
  return error instanceof ApiConnectionError ? error.kind !== 'offline'
    : !(error instanceof ApiError && error.status < 500);
}
