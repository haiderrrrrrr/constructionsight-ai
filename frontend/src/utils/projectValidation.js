const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const HTML_BRACKET_RE = /[<>]/
const LETTER_RE = /[A-Za-z]/

export const sanitizeProjectText = (value, { multiline = false } = {}) => {
    const text = String(value || '').replace(/\r\n?/g, '\n')

    if (multiline) {
        return text
            .replace(/[^\S\n]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    }

    return text.replace(/\s+/g, ' ').trim()
}

export const validateHumanText = (value, label, {
    required = true,
    min = 2,
    max = 200,
    multiline = false,
} = {}) => {
    const raw = String(value || '')
    const cleaned = sanitizeProjectText(raw, { multiline })

    if (required && !cleaned) return `${label} is required`
    if (!cleaned) return null
    if (CONTROL_CHARS_RE.test(raw)) return `${label} contains invalid hidden characters`
    if (HTML_BRACKET_RE.test(raw)) return `${label} cannot contain HTML tags`
    if (!LETTER_RE.test(cleaned)) return `${label} must include letters, not only numbers or symbols`
    if (cleaned.length < min) return `${label} must be at least ${min} characters`
    if (cleaned.length > max) return `${label} must not exceed ${max} characters`

    return null
}

export const validateProjectDetails = (formData) => {
    const errs = {}

    const nameErr = validateHumanText(formData.name, 'Project name', { min: 2, max: 200 })
    if (nameErr) errs.name = nameErr

    const locationErr = validateHumanText(formData.location, 'Site location', { min: 2, max: 300 })
    if (locationErr) errs.location = locationErr

    const clientErr = validateHumanText(formData.client_name, 'Client name', { min: 2, max: 200 })
    if (clientErr) errs.client_name = clientErr

    if (!formData.start_date) {
        errs.start_date = 'Start date is required'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.start_date)) {
        errs.start_date = 'Start date must be in YYYY-MM-DD format'
    }

    if (!formData.end_date) {
        errs.end_date = 'End date is required'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.end_date)) {
        errs.end_date = 'End date must be in YYYY-MM-DD format'
    }

    if (formData.start_date && formData.end_date && !errs.start_date && !errs.end_date) {
        const startDate = new Date(formData.start_date)
        const endDate = new Date(formData.end_date)
        if (endDate < startDate) errs.end_date = 'End date must be on or after start date'
    }

    const descriptionErr = validateHumanText(formData.description, 'Description', {
        min: 10,
        max: 2000,
        multiline: true,
    })
    if (descriptionErr) errs.description = descriptionErr

    return errs
}

export const sanitizeProjectDetails = (formData) => ({
    name: sanitizeProjectText(formData.name),
    location: sanitizeProjectText(formData.location),
    description: sanitizeProjectText(formData.description, { multiline: true }),
    client_name: sanitizeProjectText(formData.client_name),
    start_date: formData.start_date || '',
    end_date: formData.end_date || '',
})

export const validatePersonName = (value, label = 'Full name') =>
    validateHumanText(value, label, { min: 2, max: 100 })
