/**
 * Enterprise-grade error handling utility
 * Standardizes error message extraction and formatting across the entire application
 */

/**
 * Parses API error responses into user-friendly messages
 * Handles multiple error formats:
 * - Pydantic validation errors (array of error objects)
 * - FastAPI detail field (single string or object)
 * - Plain error messages
 * - Network errors
 *
 * @param {Error} err - The error object thrown by API calls
 * @param {string} fallback - Fallback message if error cannot be parsed
 * @returns {string} - User-friendly error message
 */
export function parseApiError(err, fallback = 'An error occurred') {
    if (!err) return fallback

    try {
        // Try to parse JSON error response
        const body = JSON.parse(err.message)

        // Handle Pydantic validation errors (array of error objects)
        if (Array.isArray(body)) {
            const msgs = body
                .map(e => {
                    const raw = e.msg || e.detail || e.message || 'Validation error'
                    return String(raw).replace(/^Value error,\s*/i, '')
                })
                .filter(Boolean)
            if (msgs.length > 0) return msgs[0]
        }

        // Handle FastAPI error response (detail field)
        if (body?.detail) {
            if (typeof body.detail === 'string') return body.detail
            if (Array.isArray(body.detail)) {
                const msgs = body.detail
                    .map(e => {
                        const raw = typeof e === 'string' ? e : e.msg || e.message
                        return String(raw).replace(/^Value error,\s*/i, '')
                    })
                    .filter(Boolean)
                if (msgs.length > 0) return msgs[0]
            }
            return JSON.stringify(body.detail)
        }
    } catch {
        // Not JSON, fall through to use raw message
    }

    // Use raw error message as last resort
    return err.message || err.toString() || fallback
}

/**
 * Extracts field-level errors from Pydantic validation errors
 * Maps error location to form field names
 *
 * @param {Error} err - The error object with validation errors
 * @returns {Object} - Map of field name to error message, e.g. { name: "...", email: "..." }
 */
export function extractFieldErrors(err) {
    const fieldErrors = {}

    try {
        const body = JSON.parse(err.message)

        // Parse Pydantic validation error array
        const errors = Array.isArray(body)
            ? body
            : Array.isArray(body?.detail)
                ? body.detail
                : []

        if (errors.length > 0) {
            errors.forEach(e => {
                if (e.loc && Array.isArray(e.loc) && e.loc.length > 0) {
                    // Last element in loc array is the field name
                    const fieldName = e.loc[e.loc.length - 1]
                    fieldErrors[fieldName] = String(e.msg || 'Validation error').replace(/^Value error,\s*/i, '')
                }
            })
        }
    } catch {
        // Not a validation error with field locations
    }

    return fieldErrors
}

/**
 * Checks if error indicates a conflict (concurrent edit, duplicate, etc.)
 *
 * @param {Error} err - The error object
 * @returns {boolean} - True if error is a 409 conflict
 */
export function isConflictError(err) {
    if (!err) return false

    try {
        const body = JSON.parse(err.message)
        if (body?.status === 409) return true
    } catch {}

    // Also check for 409 in error message
    return /409|conflict|already exists/i.test(err.message)
}

/**
 * Checks if error indicates authentication/authorization failure
 *
 * @param {Error} err - The error object
 * @returns {boolean} - True if error is 401/403
 */
export function isAuthError(err) {
    if (!err) return false

    try {
        const body = JSON.parse(err.message)
        if (body?.status === 401 || body?.status === 403) return true
    } catch {}

    return /401|403|unauthorized|forbidden|session expired/i.test(err.message)
}

/**
 * Checks if error indicates not found (404)
 *
 * @param {Error} err - The error object
 * @returns {boolean} - True if error is 404
 */
export function isNotFoundError(err) {
    if (!err) return false

    try {
        const body = JSON.parse(err.message)
        if (body?.status === 404) return true
    } catch {}

    return /404|not found|does not exist/i.test(err.message)
}

/**
 * Checks if error indicates validation failure
 *
 * @param {Error} err - The error object
 * @returns {boolean} - True if error contains validation errors
 */
export function isValidationError(err) {
    if (!err) return false

    try {
        const body = JSON.parse(err.message)
        if (Array.isArray(body) && body.length > 0 && body[0].loc) return true
        if (body?.detail && Array.isArray(body.detail)) return true
    } catch {}

    return false
}

/**
 * Checks if error indicates network/connection issue
 *
 * @param {Error} err - The error object
 * @returns {boolean} - True if error is network-related
 */
export function isNetworkError(err) {
    if (!err) return false

    return /network|timeout|connection|refused|unreachable|offline|dns/i.test(err.message)
}

/**
 * Gets an appropriate icon/emoji for error type
 *
 * @param {Error} err - The error object
 * @returns {string} - Emoji or icon name
 */
export function getErrorIcon(err) {
    if (isAuthError(err)) return '🔐'
    if (isNotFoundError(err)) return '🔍'
    if (isConflictError(err)) return '⚠️'
    if (isValidationError(err)) return '✗'
    if (isNetworkError(err)) return '🌐'
    return '❌'
}

/**
 * Formats error for logging (includes context)
 *
 * @param {Error} err - The error object
 * @param {string} context - What operation was being performed
 * @returns {string} - Formatted error message for logs
 */
export function formatErrorForLog(err, context = 'Operation failed') {
    const msg = parseApiError(err)
    const timestamp = new Date().toISOString()
    return `[${timestamp}] ${context}: ${msg}`
}
