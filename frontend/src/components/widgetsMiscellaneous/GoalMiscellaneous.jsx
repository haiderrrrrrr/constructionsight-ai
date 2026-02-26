import CardHeader from '@/components/shared/CardHeader'
import CircleProgress from '@/components/shared/CircleProgress';
import CardLoader from '@/components/shared/CardLoader';
import useCardTitleActions from '@/hooks/useCardTitleActions';

const staticGoalData = [
    { value: 40, revenue: "$550/$1250",      title: "Marketing Goal", color: "#ea4d4d" },
    { value: 65, revenue: "$550/$1250",      title: "Teams Goal",     color: "#3454d1" },
    { value: 50, revenue: "$850/$950",       title: "Leads Goal",     color: "#ffa21d" },
    { value: 75, revenue: "$5,655/$12,500",  title: "Revenue Goal",   color: "#17c666" },
];

const pct = (num, total) => total > 0 ? Math.round((num / total) * 100) : 0

const buildLiveGoals = (counts) => [
    {
        value: pct(counts.active, counts.total_projects),
        revenue: null,
        title: "Active Projects",
        color: "#3454d1",
    },
    {
        value: pct(counts.online_cameras, counts.total_cameras),
        revenue: null,
        title: "Cameras Online",
        color: "#17c666",
    },
    {
        value: pct(counts.approved_users, counts.total_users),
        revenue: null,
        title: "Approved Users",
        color: "#ffa21d",
    },
    {
        value: pct(counts.active + counts.archived, counts.total_projects),
        revenue: null,
        title: "Setup Completed",
        color: "#ea4d4d",
    },
]

const GoalMiscellaneous = ({ stats }) => {
    const { refreshKey, isRemoved, isExpanded, handleRefresh, handleExpand, handleDelete } = useCardTitleActions();
    const goalData = stats ? buildLiveGoals(stats.counts) : staticGoalData

    if (isRemoved) {
        return null;
    }
    return (
        <div className="col-xxl-4 d-flex">
            <div className={`card stretch stretch-full flex-grow-1 ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={"Goal Progress"} refresh={handleRefresh} remove={handleDelete} expanded={handleExpand} />

                <div className="card-body custom-card-action">
                    <div className="row g-4">
                        {goalData.map(({ color, revenue, title, value }, index) => (
                            <div key={index} className="col-sm-6">
                                <div className="px-4 py-3 text-center border border-dashed rounded-3 goal-card">
                                    <div className="mx-auto mb-4">
                                        <CircleProgress value={value} text_sym={"%"} path_color={color} />
                                    </div>
                                    <h2 className="fs-13 tx-spacing-1">{title}</h2>
                                    {revenue ? <div className="fs-11 text-muted text-truncate-1-line">{revenue}</div> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

export default GoalMiscellaneous
