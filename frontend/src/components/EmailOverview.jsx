import { emailList } from '../utils/fackData/emailList'
import getIcon from '../utils/getIcon'

const buildLiveOverviews = (counts) => [
    { id: 1, name: "Total Projects",   count: counts.total_projects, icon: "feather-layers",      color: "primary" },
    { id: 2, name: "Active",           count: counts.active,         icon: "feather-check-circle", color: "success" },
    { id: 3, name: "Archived",         count: counts.archived,       icon: "feather-archive",     color: "warning" },
    { id: 4, name: "Draft",            count: counts.draft,          icon: "feather-edit",        color: "indigo"  },
    { id: 5, name: "Total Cameras",    count: counts.total_cameras,  icon: "feather-camera",      color: "teal"    },
    { id: 6, name: "Online Cameras",   count: counts.online_cameras, icon: "feather-activity",    color: "danger"  },
]

const EmailOverview = ({ stats }) => {
    const data = stats ? buildLiveOverviews(stats.counts) : emailList.overviews

    return (
        <div className="col-12">
            <div className="card stretch stretch-full">
                <div className="card-body">
                    <div className="hstack justify-content-between mb-4 pb-">
                        <div>
                            <h5 className="mb-1">Project Overview</h5>
                        </div>
                    </div>
                    <div className="row">
                        {
                            data?.map(({ id, count, name, color, icon }) => {
                                return (
                                    <div key={id} className="col-xxl-2 col-lg-4 col-md-6 email-overview-card">
                                        <div className="card stretch stretch-full border border-dashed border-gray-5">
                                            <div className="card-body rounded-3 text-center">
                                                <i className={`fs-3 text-${color}`}>{getIcon(icon)}</i>
                                                <div className="fs-4 fw-bolder text-dark mt-3 mb-1">{count}</div>
                                                <p className="fs-12 fw-medium text-muted text-spacing-1 mb-0 text-truncate-1-line">{name}</p>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        }
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EmailOverview
