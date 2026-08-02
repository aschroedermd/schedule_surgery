import type { Role } from "../shared/types";

interface ErrorViewer {
  role?: Role;
  username?: string;
}

export function canSeeDiagnosticErrors(viewer: ErrorViewer | undefined): boolean {
  return viewer?.role === "admin" || viewer?.username?.trim().toLowerCase() === "aschroeder";
}

export function presentActionError(error: unknown, fallback: string, showDiagnostics: boolean): string {
  if (error instanceof Error && error.message) {
    if (showDiagnostics) return error.message;
    const status = "status" in error ? Number(error.status) : undefined;
    if (status && status >= 400 && status < 500) return error.message;
  }
  return fallback;
}

export function presentBackgroundError(error: unknown, showDiagnostics: boolean): string | undefined {
  return showDiagnostics && error instanceof Error && error.message ? error.message : undefined;
}
