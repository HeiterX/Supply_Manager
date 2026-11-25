import type {
  RequestHandler,
  Response,
} from 'express';

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

function denyRequest(response: Response): void {
  response.status(403).json({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Запрос отклонён проверкой безопасности источника',
  });
}

export function createCsrfOriginMiddleware(
  trustedOrigins: readonly string[],
): RequestHandler {
  const allowedOrigins = new Set(trustedOrigins);

  return (request, response, next) => {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    const origin = request.get('Origin');
    const referer = request.get('Referer');
    const fetchSite = request.get('Sec-Fetch-Site');

    if (origin !== undefined) {
      if (!allowedOrigins.has(origin)) {
        denyRequest(response);
        return;
      }

      next();
      return;
    }

    if (referer !== undefined) {
      try {
        const refererOrigin = new URL(referer).origin;

        if (!allowedOrigins.has(refererOrigin)) {
          denyRequest(response);
          return;
        }

        next();
        return;
      } catch {
        denyRequest(response);
        return;
      }
    }

    if (
      fetchSite !== undefined &&
      fetchSite !== 'same-origin'
    ) {
      denyRequest(response);
      return;
    }

    // Временный режим совместимости.
    // Обязательную CSRF-проверку добавим отдельно.
    next();
  };
}
