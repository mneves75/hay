import { validateSession } from "../auth/session";
export function login(token: string): boolean {
  return validateSession(token);
}
