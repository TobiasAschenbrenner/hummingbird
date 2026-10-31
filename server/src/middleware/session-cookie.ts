import type { CookieOptions, Request, Response } from 'express';

export function createSessionCookie(secure: boolean) {
  const name = secure ? '__Host-hummingbird_session' : 'hummingbird_session';
  const options: CookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  return {
    read(request: Request): string | undefined {
      const values = (request.get('Cookie') ?? '')
        .split(';')
        .map((cookie) => cookie.trim())
        .filter((cookie) => cookie.startsWith(`${name}=`));
      return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
    },
    set(response: Response, token: string, expiresAt: Date) {
      response.cookie(name, token, { ...options, expires: expiresAt });
    },
    clear(response: Response) {
      response.clearCookie(name, options);
    },
  };
}
