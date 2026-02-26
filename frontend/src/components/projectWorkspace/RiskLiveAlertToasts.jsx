import LiveAlertToasts from './LiveAlertToasts'
import useRiskStream from '@/hooks/useRiskStream'
import { getCurrentUserId } from '@/utils/api'

const RISK_CONFIG = {
    storageKey:      (projectId) => `risk-alerts-${getCurrentUserId()}-${projectId}`,
    eventNS:         'risk',
    alertLabels: {
        high:     { short: 'High Risk',     color: 'warning', icon: 'feather-alert-triangle' },
        critical: { short: 'Critical Risk', color: 'danger',  icon: 'feather-alert-circle'   },
    },
    defaultLabel:    { short: 'Risk Alert', color: 'warning', icon: 'feather-alert-triangle' },
    streamHook:      useRiskStream,
    getAlertTypeKey: (alert) => alert.severity ?? 'high',
    getNavUrl:       (_alert, projectId) => `/projects/${projectId}/risk`,
    navTitle:        'Click to view Risk Analytics',
    drawerIcon:      'feather-shield',
    drawerIconColor: '#dc3545',
    drawerTitle:     'Risk Alerts',
    overflowBtnColor: '#dc3545',
    overflowBtnText:  '#fff',
    overflowBtnIcon:  'feather-shield',
    animKeyframe:    'risk-timer',
    timeOnNewLine:   true,
    getLine3:        (alert) => alert.message ?? alert.zone_name ?? '',
}

export default function RiskLiveAlertToasts({ projectId }) {
    return <LiveAlertToasts config={RISK_CONFIG} projectId={projectId} />
}
