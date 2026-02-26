/**
 * Unified project status metadata for consistent styling and labels across all pages.
 * This is the single source of truth for project status badges and colors.
 *
 * Backend status values: draft, setup_in_progress, active, archived
 * Frontend normalized keys: draft, setup, active, archived
 */

export const getProjectStatusMeta = (rawStatus) => {
  const normalized = String(rawStatus || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

  // If backend sends "setup_in_progress" or "in_progress", normalize to "setup"
  const key = normalized.includes('setup') ? 'setup' : normalized

  const statusMap = {
    draft: {
      label: 'Draft',
      color: 'bg-soft-danger text-danger',
      badge: 'badge bg-soft-danger text-danger',
      progress: 25,
      progressColor: 'danger',
    },
    setup: {
      label: 'Setup',
      color: 'bg-soft-teal text-teal',
      badge: 'badge bg-soft-teal text-teal',
      progress: 60,
      progressColor: 'warning',
    },
    active: {
      label: 'Active',
      color: 'bg-soft-success text-success',
      badge: 'badge bg-soft-success text-success',
      progress: 100,
      progressColor: 'success',
    },
    archived: {
      label: 'Archived',
      color: 'bg-soft-primary text-primary',
      badge: 'badge bg-soft-primary text-primary',
      progress: 100,
      progressColor: 'primary',
    },
  }

  return statusMap[key] || {
    label: normalized ? normalized.replace(/\b\w/g, c => c.toUpperCase()) : '—',
    color: 'bg-soft-warning text-warning',
    badge: 'badge bg-soft-warning text-warning',
    progress: 50,
    progressColor: 'warning',
  }
}
