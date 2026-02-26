import { useEffect } from 'react'
import LiveAlertToasts from './LiveAlertToasts'
import usePPEStream from '@/hooks/usePPEStream'
import { getCurrentUserId } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const PPE_CONFIG = {
    storageKey:      (projectId) => `ppe-alerts-${getCurrentUserId()}-${projectId}`,
    eventNS:         'ppe',
    alertLabels: {
        no_helmet:    { short: 'No Helmet',      color: 'warning', icon: 'feather-alert-triangle' },
        no_vest:      { short: 'No Vest',        color: 'warning', icon: 'feather-alert-triangle' },
        both_missing: { short: 'No Helmet/Vest', color: 'danger',  icon: 'feather-alert-circle'   },
    },
    defaultLabel:    { short: 'Violation',    color: 'danger',  icon: 'feather-alert-circle' },
    streamHook:      usePPEStream,
    getAlertTypeKey: (alert) => alert.incident_type,
    getNavUrl:       (_alert, projectId) => `/projects/${projectId}/reports/ppe`,
    navTitle:        'Click to view PPE reports',
    drawerIcon:      'feather-alert-circle',
    drawerIconColor: '#dc3545',
    drawerTitle:     'Live Alerts',
    overflowBtnColor: '#dc3545',
    overflowBtnText:  '#fff',
    overflowBtnIcon:  'feather-bell',
    animKeyframe:    'ppe-timer',
    getLine3:        (alert) => alert.person_id ?? '',
}

export const openPPEAlertsDrawer = () => {
    window.dispatchEvent(new CustomEvent('ppe:open-alerts-drawer'))
}

export default function PPELiveAlertToasts({ projectId }) {
    // Clear toasts when another window broadcasts PPE-off — SSE alone is too slow for cross-window sync
    useEffect(() => {
        return onBroadcast('ppe:feature-changed', ({ projectId: pid, anyActive } = {}) => {
            if (String(pid) !== String(projectId)) return
            if (anyActive === false) {
                window.dispatchEvent(new Event('cs:alerts-clear-all'))
            }
        })
    }, [projectId])

    return <LiveAlertToasts config={PPE_CONFIG} projectId={projectId} />
}
