import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import InvoiceCreate from '@/components/payment/InvoiceCreate'

const PaymentCreate = () => {
    return (
        <>
            <PageHeader>
                {/* <PaymentHeader /> */}
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    {/* <PaymentTable /> */}
                    <InvoiceCreate />
                </div>
            </div>
        </>
    )
}

export default PaymentCreate