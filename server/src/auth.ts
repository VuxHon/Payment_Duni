import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config, isProduction } from './config.js';

const COOKIE = 'payment_session';
const sign = (value: string) => createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url');
const passwordDigest = (value: string) => scryptSync(value, config.SESSION_SECRET.slice(0, 16), 32);

export function verifyLogin(username: string, password: string) {
  const nameOk = username === config.ADMIN_USERNAME;
  const supplied = passwordDigest(password);
  const expected = passwordDigest(config.ADMIN_PASSWORD);
  return nameOk && timingSafeEqual(supplied, expected);
}

export function setSession(res: Response) {
  const payload = Buffer.from(JSON.stringify({ sub: config.ADMIN_USERNAME, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: isProduction, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000, path: '/' });
}
export function clearSession(res: Response) { res.clearCookie(COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' }); }
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const [payload, signature] = String(req.cookies?.[COOKIE] || '').split('.');
    if (!payload || !signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.sub !== config.ADMIN_USERNAME || data.exp < Date.now()) throw new Error();
    next();
  } catch { res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' }); }
}

