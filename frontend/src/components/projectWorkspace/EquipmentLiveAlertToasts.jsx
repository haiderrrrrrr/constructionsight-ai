import { useEffect } from 'react'
import LiveAlertToasts from './LiveAlertToasts'
import useEquipmentStream from '@/hooks/useEquipmentStream'
import { getCurrentUserId } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const EQ_CONFIG = {
    storageKey:      (projectId) => `eq-alerts-${getCurrentUserId()}-${projectId}`,
    eventNS:         'eq',
    alertLabels: {
        idle_waste:          { short: 'Idle Waste Detected',   color: 'warning', icon: 'feather-clock'         },
        active_no_workers:   { short: 'Active – No Workers',   color: 'danger',  icon: 'feather-alert-circle'  },
        ghost_equipment:     { short: 'Ghost Equipment',       color: 'danger',  icon: 'feather-eye-off'       },
        overuse:             { short: 'Equipment Overuse',     color: 'danger',  icon: 'feather-trending-up'   },
        cross_zone_conflict: { short: 'Cross-Zone Conflict',   color: 'danger',  icon: 'feather-shuffle'       },
    },
    defaultLabel:    { short: 'Equipment Alert', color: 'warning', icon: 'feather-alert-triangle' },
    streamHook:      useEquipmentStream,
    getAlertTypeKey: (alert) => alert.alert_type,
    getNavUrl:       (alert, projectId) => alert.camera_id
        ? `/projects/${projectId}/equipment?camera=${alert.camera_id}`
        : `/projects/${projectId}/equipment`,
    navTitle:        'Click to view Equipment Analytics',
    drawerIcon:      'feather-tool',
    drawerIconColor: '#fd7e14',
    drawerTitle:     'Equipment Alerts',
    overflowBtnColor: '#fd7e14',
    overflowBtnText:  '#fff',
    overflowBtnIcon:  'feather-tool',
    animKeyframe:    'eq-timer',
    getLine3:        (alert) => alert.message ?? '',
    timeOnNewLine:   true,
}

export const openEquipmentAlertsDrawer = () => {
    window.dispatchEvent(new CustomEvent('eq:open-alerts-drawer'))
}

export default function EquipmentLiveAlertToasts({ projectId }) {
    useEffect(() => {
        return onBroadcast('eq:feature-changed', ({ projectId: pid, anyActive } = {}) => {
            if (String(pid) !== String(projectId)) return
            if (anyActive === false) window.dispatchEvent(new Event('cs:alerts-clear-all'))
        })
    }, [projectId])

    return <LiveAlertToasts config={EQ_CONFIG} projectId={projectId} />
}
