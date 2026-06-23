/**
 * Serialize a function to a string for embedding in templates
 */
export function serializeFunction(
  fn: ((...args: any[]) => any) | undefined,
  _name: string,
): string {
  if (!fn) return 'undefined'

  const fnStr = fn.toString()

  // Handle arrow functions and regular functions
  if (fnStr.startsWith('function')) {
    // Regular function - extract body
    return fnStr
  } else if (fnStr.startsWith('(') || fnStr.startsWith('async (')) {
    // Arrow function with parentheses
    return fnStr
  } else {
    // Arrow function without parentheses or method shorthand
    return fnStr
  }
}
