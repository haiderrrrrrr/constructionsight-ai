/**
 * Centralized React Query key registry.
 * All query keys are defined here to prevent string duplication and enable safe invalidation.
 */

export const QK = {
  // ─────────────────────────────────────────────────────────────────
  // PPE Safety System
  // ─────────────────────────────────────────────────────────────────
  ppeSummary: (projectId, dateFrom, dateTo) =>
    ['ppe', 'summary', projectId, dateFrom, dateTo],

  ppeTrend: (projectId, dateFrom, dateTo) =>
    ['ppe', 'trend', projectId, dateFrom, dateTo],

  ppeZones: (projectId, dateFrom, dateTo) =>
    ['ppe', 'zones', projectId, dateFrom, dateTo],

  ppeCameras: (projectId, dateFrom, dateTo) =>
    ['ppe', 'cameras', projectId, dateFrom, dateTo],

  ppeAnalytics: (projectId, dateFrom, dateTo) =>
    ['ppe', 'analytics', projectId, dateFrom, dateTo],

  ppeIncidents: (projectId, page, dateFrom, dateTo, statusFilter) =>
    ['ppe', 'incidents', projectId, page, dateFrom, dateTo, statusFilter],

  ppeStatus: (projectId) =>
    ['ppe', 'status', projectId],

  // ─────────────────────────────────────────────────────────────────
  // Activity System
  // ─────────────────────────────────────────────────────────────────
  actSummary: (projectId, dateFrom, dateTo, cameraId) =>
    ['activity', 'summary', projectId, dateFrom, dateTo, cameraId ?? null],

  actCameras: (projectId, dateFrom = null, dateTo = null) =>
    ['activity', 'cameras', projectId, dateFrom ?? null, dateTo ?? null],

  actSettings: (projectId) =>
    ['activity', 'settings', projectId],

  actTrend: (projectId, dateFrom, dateTo) =>
    ['activity', 'trend', projectId, dateFrom, dateTo],

  actTrendLive: (projectId) =>
    ['activity', 'trend-live', projectId],

  actHeatmap: (projectId, cameraId, dateFrom, dateTo) =>
    ['activity', 'heatmap', projectId, cameraId, dateFrom, dateTo],

  actScatter: (projectId, cameraId, dateFrom, dateTo) =>
    ['activity', 'scatter', projectId, cameraId, dateFrom, dateTo],

  actStatus: (projectId) =>
    ['activity', 'status', projectId],

  actAlerts: (projectId, page, dateFrom, dateTo, statusFilter, cameraId) =>
    ['activity', 'alerts', projectId, page, dateFrom, dateTo, statusFilter ?? null, cameraId ?? null],

  // ─────────────────────────────────────────────────────────────────
  // Workforce System
  // ─────────────────────────────────────────────────────────────────
  wfSummary: (projectId, dateFrom, dateTo, cameraId) =>
    ['workforce', 'summary', projectId, dateFrom, dateTo, cameraId ?? null],

  wfCameras: (projectId, dateFrom = null, dateTo = null) =>
    ['workforce', 'cameras', projectId, dateFrom ?? null, dateTo ?? null],

  wfSettings: (projectId) =>
    ['workforce', 'settings', projectId],

  wfTrend: (projectId, trendRange, cameraId) =>
    ['workforce', 'trend', projectId, trendRange, cameraId],

  wfTrendLive: (projectId) =>
    ['workforce', 'trend-live', projectId],

  wfHeatmap: (projectId, cameraId, dateFrom, dateTo) =>
    ['workforce', 'heatmap', projectId, cameraId, dateFrom, dateTo],

  wfScatter: (projectId, cameraId, dateFrom, dateTo) =>
    ['workforce', 'scatter', projectId, cameraId, dateFrom, dateTo],

  wfStatus: (projectId) =>
    ['workforce', 'status', projectId],

  wfAlerts: (projectId, page, dateFrom, dateTo, statusFilter, cameraId) =>
    ['workforce', 'alerts', projectId, page, dateFrom, dateTo, statusFilter ?? null, cameraId ?? null],

  // ─────────────────────────────────────────────────────────────────
  // Equipment Usage System
  // ─────────────────────────────────────────────────────────────────
  eqSummary: (projectId, dateFrom, dateTo, cameraId) =>
    ['equipment', 'summary', projectId, dateFrom, dateTo, cameraId ?? null],

  eqCameras: (projectId, dateFrom = null, dateTo = null) =>
    ['equipment', 'cameras', projectId, dateFrom ?? null, dateTo ?? null],

  eqSettings: (projectId) =>
    ['equipment', 'settings', projectId],

  eqTrend: (projectId, trendRange, cameraId) =>
    ['equipment', 'trend', projectId, trendRange, cameraId],

  eqTrendLive: (projectId) =>
    ['equipment', 'trend-live', projectId],

  eqScatter: (projectId, cameraId, dateFrom, dateTo) =>
    ['equipment', 'scatter', projectId, cameraId, dateFrom, dateTo],

  eqStatus: (projectId) =>
    ['equipment', 'status', projectId],

  eqAlerts: (projectId, page, dateFrom, dateTo, statusFilter, cameraId) =>
    ['equipment', 'alerts', projectId, page, dateFrom, dateTo, statusFilter ?? null, cameraId ?? null],

  // ─────────────────────────────────────────────────────────────────
  // Risk Analytics System
  // ─────────────────────────────────────────────────────────────────
  riskSummary: (projectId) =>
    ['risk', 'summary', projectId],

  riskTrend: (projectId, hours) =>
    ['risk', 'trend', projectId, hours ?? 2],

  riskZones: (projectId) =>
    ['risk', 'zones', projectId],

  riskEvents: (projectId, page, severity, status) =>
    ['risk', 'events', projectId, page, severity ?? null, status ?? null],

  riskSchedulerStatus: (projectId) =>
    ['risk', 'scheduler', 'status', projectId],
}
