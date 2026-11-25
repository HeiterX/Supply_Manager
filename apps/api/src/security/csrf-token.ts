import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const CSRF_CONTEXT = 'supply-manager:csrf:v1:';

function getSigningSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET должен содержать минимум 32 символа',
    );
  }

  return secret;
}

/**
 * Создаёт CSRF-токен, привязанный
 * к конкретной JWT-сессии.
 */
export function createCsrfToken(
  sessionToken: string,
): string {
  return createHmac('sha256', getSigningSecret())
    .update(CSRF_CONTEXT)
    .update(sessionToken)
    .digest('hex');
}

/**
 * Проверяет CSRF-токен.
 */
export function verifyCsrfToken(
  sessionToken: string,
  candidate: unknown,
): boolean {
  if (
    typeof candidate !== 'string' ||
    !CSRF_TOKEN_PATTERN.test(candidate)
  ) {
    return false;
  }

  const expected = Buffer.from(
    createCsrfToken(sessionToken),
    'hex',
  );

  const received = Buffer.from(candidate, 'hex');

  return timingSafeEqual(expected, received);
}
