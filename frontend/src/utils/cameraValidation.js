const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const HTML_BRACKET_RE = /[<>]/
const LETTER_RE = /[A-Za-z]/

export const sanitizeCameraText = (value) =>
    String(value || '').replace(/\s+/g, ' ').trim()

const validateText = (value, label, {
    required = false,
    min = 2,
    max = 200,
    requireLetter = true,
} = {}) => {
    const raw = String(value || '')
    const text = sanitizeCameraText(raw)

    if (required && !text) return 'Required'
    if (!text) return null
    if (CONTROL_CHARS_RE.test(raw)) return 'Invalid chars'
    if (HTML_BRACKET_RE.test(raw)) return 'No HTML'
    if (text.length < min) return `Min ${min} chars`
    if (text.length > max) return `Max ${max} chars`
    if (requireLetter && !LETTER_RE.test(text)) return 'Add letters'

    return null
}

export const validateCameraIdentity = (draft) => {
    const errs = {}

    const nameErr = validateText(draft.name, 'Camera name', { required: true, min: 3, max: 200 })
    if (nameErr) errs.name = nameErr

    const vendorErr = validateText(draft.vendor, 'Vendor', { min: 2, max: 200 })
    if (vendorErr) errs.vendor = vendorErr

    const modelErr = validateText(draft.model, 'Model', { min: 2, max: 200 })
    if (modelErr) errs.model = modelErr

    const serialErr = validateText(draft.serial_number, 'Serial', {
        min: 1,
        max: 200,
        requireLetter: false,
    })
    if (serialErr) errs.serial_number = serialErr

    return errs
}

export const sanitizeCameraIdentity = (draft) => ({
    name: sanitizeCameraText(draft.name),
    vendor: sanitizeCameraText(draft.vendor),
    model: sanitizeCameraText(draft.model),
    serial_number: sanitizeCameraText(draft.serial_number),
})
