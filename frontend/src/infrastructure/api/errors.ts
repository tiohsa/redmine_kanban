import { isHttpError } from './http';

type FieldErrors = {
  subject?: string[];
};

type ErrorPayload = {
  message?: string;
  field_errors?: FieldErrors;
  error?: { code?: string };
};

function errorPayload(error: unknown): ErrorPayload | null {
  if (!isHttpError<ErrorPayload>(error) || !error.payload || typeof error.payload !== 'object') return null;
  return error.payload;
}

export function fieldError(fieldErrors: unknown): string | null {
  if (!fieldErrors || typeof fieldErrors !== 'object' || !('subject' in fieldErrors)) return null;

  const subject = (fieldErrors as FieldErrors).subject;
  if (subject?.length) return subject[0];
  return null;
}

export function payloadMessage(error: unknown): string | null {
  const payload = errorPayload(error);
  return payload?.message ?? null;
}

export function payloadFieldError(error: unknown): string | null {
  return fieldError(errorPayload(error)?.field_errors);
}

export function isWorkflowTransitionError(error: unknown): boolean {
  return errorPayload(error)?.error?.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED';
}

export function resolveMutationError(
  error: unknown,
  labels: Record<string, string> | undefined,
  fallback?: string,
): string {
  const status = isHttpError<ErrorPayload>(error) ? error.status : undefined;
  const message = payloadMessage(error);

  if (status === 409) {
    return labels?.conflict ?? '';
  }

  return message || fallback || labels?.update_failed || '';
}
