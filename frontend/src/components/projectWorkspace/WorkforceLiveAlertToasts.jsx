import { useEffect } from 'react'
import LiveAlertToasts from './LiveAlertToasts'
import useWorkforceStream from '@/hooks/useWorkforceStream'
import { getCurrentUserId } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const WF_CONFIG = {
    storageKey:      (projectId) => `wf-alerts-${getCurrentUserId()}-${projectId}`,
    eventNS:         'wf',
    alertLabels: {
        understaffed:    { short: 'Zone Understaffed',    color: 'warning', icon: 'feather-users'         },
        idle_ratio_high: { short: 'High Idle Ratio',      color: 'warning', icon: 'feather-moon'          },
        sudden_drop:     { short: 'Worker Drop Detected', color: 'danger',  icon: 'feather-trending-down' },
        overload:        { short: 'Zone Overload',        color: 'danger',  icon: 'feather-alert-circle'  },
    },
    defaultLabel:    { short: 'Workforce Alert', color: 'warning', icon: 'feather-alert-triangle' },
    streamHook:      useWorkforceStream,
    getAlertTypeKey: (alert) => alert.alert_type,
    getNavUrl:       (alert, projectId) => alert.camera_id
        ? `/projects/${projectId}/reports/workforce?camera=${alert.camera_id}`
        : `/projects/${projectId}/reports/workforce`,
    navTitle:        'Click to view Workforce Analytics',
    drawerIcon:      'feather-users',
    drawerIconColor: '#ffc107',
    drawerTitle:     'Workforce Alerts',
    overflowBtnColor: '#ffc107',
    overflowBtnText:  '#000',
    overflowBtnIcon:  'feather-users',
    animKeyframe:    'wf-timer',
    getLine3:        (alert) => alert.message ?? '',
    timeOnNewLine:   true,
}

export const openWorkforceAlertsDrawer = () => {
    window.dispatchEvent(new CustomEvent('wf:open-alerts-drawer'))
}

export default function WorkforceLiveAlertToasts({ projectId }) {
    useEffect(() => {
        return onBroadcast('wf:feature-changed', ({ projectId: pid, anyActive } = {}) => {
            if (String(pid) !== String(projectId)) return
            if (anyActive === false) window.dispatchEvent(new Event('cs:alerts-clear-all'))
        })
    }, [projectId])

    return <LiveAlertToasts config={WF_CONFIG} projectId={projectId} />
}
