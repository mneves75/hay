export function validateSession(token: string): boolean {
  return token.length > 0;
}
