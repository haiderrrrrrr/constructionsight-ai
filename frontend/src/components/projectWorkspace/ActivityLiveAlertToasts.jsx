import { useEffect } from 'react'
import LiveAlertToasts from './LiveAlertToasts'
import useActivityStream from '@/hooks/useActivityStream'
import { getCurrentUserId } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const ACT_CONFIG = {
    storageKey:      (projectId) => `act-alerts-${getCurrentUserId()}-${projectId}`,
    eventNS:         'act',
    openCountField:  'open_alerts',
    alertLabels: {
        zone_idle:              { short: 'Zone Idle Detected',  color: 'warning', icon: 'feather-clock'          },
        activity_drop:          { short: 'Activity Drop',       color: 'danger',  icon: 'feather-trending-down'  },
        low_activity_sustained: { short: 'Low Activity',        color: 'warning', icon: 'feather-activity'       },
        repeated_inactivity:    { short: 'Repeated Inactivity', color: 'warning', icon: 'feather-alert-triangle' },
    },
    defaultLabel:    { short: 'Activity Alert', color: 'warning', icon: 'feather-alert-triangle' },
    streamHook:      useActivityStream,
    getAlertTypeKey: (alert) => alert.alert_type,
    getNavUrl:       (alert, projectId) => alert.camera_id
        ? `/projects/${projectId}/reports/activity?camera=${alert.camera_id}`
        : `/projects/${projectId}/reports/activity`,
    navTitle:        'Click to view Activity Monitoring',
    drawerIcon:      'feather-activity',
    drawerIconColor: '#ffc107',
    drawerTitle:     'Activity Alerts',
    overflowBtnColor: '#ffc107',
    overflowBtnText:  '#000',
    overflowBtnIcon:  'feather-activity',
    animKeyframe:    'act-timer',
    getLine3:        (alert) => alert.message ?? '',
}

export const openActivityAlertsDrawer = () => {
    window.dispatchEvent(new CustomEvent('act:open-alerts-drawer'))
}

export default function ActivityLiveAlertToasts({ projectId }) {
    useEffect(() => {
        return onBroadcast('act:feature-changed', ({ projectId: pid, anyActive } = {}) => {
            if (String(pid) !== String(projectId)) return
            if (anyActive === false) window.dispatchEvent(new Event('cs:alerts-clear-all'))
        })
    }, [projectId])

    return <LiveAlertToasts config={ACT_CONFIG} projectId={projectId} />
}
