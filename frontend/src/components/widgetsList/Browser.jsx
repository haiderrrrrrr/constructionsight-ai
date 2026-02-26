import { Link } from 'react-router-dom'
import CardHeader from '@/components/shared/CardHeader'
import { browserList } from '@/utils/fackData/browserList'
import useCardTitleActions from '@/hooks/useCardTitleActions'
import CardLoader from '@/components/shared/CardLoader'
import getIcon from '@/utils/getIcon'
import HorizontalProgress from '@/components/shared/HorizontalProgress'

const pct = (num, total) => total > 0 ? Math.round((num / total) * 100) : 0

const buildLiveRows = (counts) => [
    { id: 1, browser_name: "Active Projects",    total_user: pct(counts.active,          counts.total_projects), iconColor: "success",  progressColor: "success",  icon: "feather-check-circle" },
    { id: 2, browser_name: "Archived Projects",  total_user: pct(counts.archived,        counts.total_projects), iconColor: "warning",  progressColor: "warning",  icon: "feather-archive"      },
    { id: 3, browser_name: "Draft Projects",     total_user: pct(counts.draft,           counts.total_projects), iconColor: "indigo",   progressColor: "primary",  icon: "feather-edit"         },
    { id: 4, browser_name: "Setup In Progress",  total_user: pct(counts.setup,           counts.total_projects), iconColor: "info",     progressColor: "info",     icon: "feather-settings"     },
    { id: 5, browser_name: "Online Cameras",     total_user: pct(counts.online_cameras,  counts.total_cameras),  iconColor: "teal",     progressColor: "teal",     icon: "feather-camera"       },
    { id: 6, browser_name: "Approved Users",     total_user: pct(counts.approved_users,  counts.total_users),    iconColor: "primary",  progressColor: "primary",  icon: "feather-user-check"   },
]

const Browser = ({ title, stats }) => {
    const { refreshKey, isRemoved, isExpanded, handleRefresh, handleExpand, handleDelete } = useCardTitleActions();
    const data = stats ? buildLiveRows(stats.counts) : browserList

    if (isRemoved) {
        return null;
    }
    return (
        <div className="col-xxl-4">
            <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={title} refresh={handleRefresh} remove={handleDelete} expanded={handleExpand} />
                <div className="card-body custom-card-action p-0">
                    <style>{`
                        .cs-stats-bars td:last-child { width: 48%; }
                        .cs-stats-bars .cs-bar-wrap { width: 100%; display: flex; align-items: center; gap: 12px; justify-content: flex-end; }
                        .cs-stats-bars .cs-bar-pct { width: 42px; text-align: right; font-weight: 700; }
                        .cs-stats-bars .progress { flex: 1 1 auto; margin: 0; }
                    `}</style>
                    <div className="table-responsive">
                        <table className="table table-hover mb-0 cs-stats-bars">
                            <tbody>
                                {
                                    data.map(({ browser_name, id, total_user, icon, iconColor, progressColor }) =>
                                        <tr key={id}>
                                            <td>
                                                <Link to="#">
                                                    <i className={`fs-16 text-primary me-2 text-${iconColor}`}>{getIcon(icon)}</i>
                                                    <span>{browser_name}</span>
                                                </Link>
                                            </td>
                                            <td>
                                                <span className="cs-bar-wrap m-0">
                                                    <span className="cs-bar-pct">{total_user}%</span>
                                                    <HorizontalProgress progress={total_user} barHeight='w-100 ht-5' barColor={`bg-${progressColor}`} />
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

export default Browser
