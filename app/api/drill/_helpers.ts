export function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export {
  errorResponse,
  handleRouteError,
  jsonResponse,
  readJsonBody,
} from "../attempts/_helpers";
