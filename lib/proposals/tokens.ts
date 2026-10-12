import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/** Token do link público: 256 bits aleatórios (base64url). Só o SHA-256 vai ao banco; o token é mostrado uma vez ao usuário. */
export function generateShareToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token em formato válido? (43 caracteres base64url). Evita consulta ao banco com lixo. */
export function isTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
