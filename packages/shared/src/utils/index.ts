/**
 * Shared Utilities
 * Common utility functions used across frontend and backend
 */

/**
 * Format a filename to a human-readable label
 * @example formatLabel('basic-fade') => 'Basic Fade'
 */
export function formatLabel(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '') // Remove extension
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Safely parse JSON with a fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
