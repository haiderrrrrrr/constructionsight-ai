import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import SmartQueryAssistant from '@/components/smartQuery/SmartQueryAssistant'

const AdminSmartQueryPage = () => {
  return (
    <>
      <PageHeader />

      <div className="main-content" style={{ paddingTop: 0 }}>
        <div className="card border-0 shadow-sm overflow-hidden">
          <SmartQueryAssistant scope="global" projectId={null} />
        </div>
      </div>
    </>
  )
}

export default AdminSmartQueryPage
