import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import PaymentHeader from '@/components/payment/PaymentHeader'
import InvoiceView from '@/components/payment/InvoiceView'

const PaymentView = () => {
    return (
        <>
            <PageHeader>
                <PaymentHeader />
            </PageHeader>
            <div className='main-content container-lg'>
                <div className='row'>
                    {/* <PaymentTable /> */}
                    <InvoiceView />
                </div>
            </div>

        </>
    )
}

export default PaymentView