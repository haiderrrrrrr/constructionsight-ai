import CardHeader from '@/components/shared/CardHeader'
import ReactApexChart from 'react-apexcharts'
import { visitorsOverviewChartOption } from '@/utils/chartsLogic/visitorsOverviewChartOption'
import useCardTitleActions from '@/hooks/useCardTitleActions'
import CardLoader from '@/components/shared/CardLoader'

const VisitorsOverviewChart = ({ stats }) => {
    const chartOption = visitorsOverviewChartOption(stats)
    const { refreshKey, isRemoved, isExpanded, handleRefresh, handleExpand, handleDelete } = useCardTitleActions();

    if (isRemoved) {
        return null;
    }
    return (
        <div className="col-xxl-8">
            <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={"Activity Overview"} refresh={handleRefresh} remove={handleDelete} expanded={handleExpand} />

                <div className="card-body custom-card-action">
                    <ReactApexChart
                        options={chartOption}
                        series={chartOption?.series}
                        type='line'
                        height={370}
                    />
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

export default VisitorsOverviewChart
