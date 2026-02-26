import React from 'react'
import { FiDollarSign, FiDownload, FiEdit, FiFacebook, FiGithub, FiInstagram, FiLinkedin, FiPrinter, FiSend, FiTwitter } from 'react-icons/fi'
import Dropdown from '@/components/shared/Dropdown'

export const invoiceTempletOptions = [
    { icon: '', label: "Default" },
    { icon: '', label: "Classic" },
    { icon: '', label: "Simple" },
    { icon: '', label: "Modern" },
    { icon: '', label: "Untimate" },
    { icon: '', label: "Essential" },
    { type: "divider" },
    { icon: '', label: "Create Template" },
    { icon: '', label: "Delete Template" },
]

const invoiceServiceData = [
    {
        name: "Adata",
        description: "Modern & Minimal Multipurpose Bootstrap Admin Dashboard",
        price: 50.00,
        quantity: 10,
    },
    {
        name: "Avesta",
        description: "Multipurpose Bootstrap4 Admin Dashboard Template",
        price: 120.00,
        quantity: 10,
    },
    {
        name: "Metrical",
        description: "Multipurpose Bootstrap4 Admin Dashboard Template",
        price: 450.00,
        quantity: 1,
    },
    {
        name: "Avesta",
        description: "Multipurpose Bootstrap4 Admin Dashboard Template",
        price: 120.00,
        quantity: 10,
    },
    {
        name: "Duralux",
        description: "Admin Dashboard & Webapps Template",
        price: 50.00,
        quantity: 10,
    }
]
const InvoiceView = () => {
    const subTotalPrice = invoiceServiceData.reduce((accumulator, currentValue) => accumulator + currentValue.price * currentValue.quantity, 0)
    const discount = subTotalPrice * 0.15;
    const discountedPrice = subTotalPrice - discount;
    const taxAmount = discountedPrice * 0.125;
    return (
        <div className="col-lg-12">
            <div className="card invoice-container">
                <div className="card-header">
                    <div>
                        <h2 className="fs-16 fw-700 text-truncate-1-line mb-0 mb-sm-1">Invoice Preview</h2>
                        <Dropdown
                            dropdownItems={invoiceTempletOptions}
                            dropdownParentStyle={"d-none d-sm-block"}
                            triggerClass='dropdown-toggle d-flex align-items-center fs-11 fw-400 text-muted me-2'
                            triggerPosition={"0, 25"}
                            triggerText={"Invoice Templates"}
                            triggerIcon={" "}
                            isAvatar={false}
                            dropdownPosition='dropdown-menu-start'
                        />
                    </div>
                    <div className="d-flex align-items-center justify-content-center">
                        <a href="#" className="d-flex me-1" data-alert-target="invoicSendMessage">
                            <div className="avatar-text avatar-md" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Send Invoice">
                                <FiSend strokeWidth={1.6} size={12} />
                            </div>
                        </a>
                        <a href="#" className="d-flex me-1 printBTN">
                            <div className="avatar-text avatar-md" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Print Invoice">
                                <FiPrinter strokeWidth={1.6} size={12} />
                            </div>
                        </a>
                        <a href="#" className="d-flex me-1">
                            <div className="avatar-text avatar-md" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Add Payment">
                                <FiDollarSign strokeWidth={1.6} size={12} />
                            </div>
                        </a>
                        <a href="#" className="d-flex me-1 file-download">
                            <div className="avatar-text avatar-md" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Download Invoice">
                                <FiDownload size={12} />
                            </div>
                        </a>
                        <a href="invoice-create.html" className="d-flex me-1">
                            <div className="avatar-text avatar-md" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Edit Invoice">
                                <FiEdit strokeWidth={1.6} size={12} />
                            </div>
                        </a>
                    </div>
                </div>
                <div className="card-body p-0">
                    <div className="px-4 pt-4">
                        <div className="d-sm-flex align-items-center justify-content-between">
                            <div>
                                <div className="fs-24 fw-bolder font-montserrat-alt text-uppercase">Duralux</div>
                                <address className="text-muted">
                                    P.O. Box 18728,<br />
                                    DeLorean New York<br />
                                    VAT No: 2617 348 2752
                                </address>
                                <div className="d-flex gap-2">
                                    <a href="#" className="avatar-text avatar-sm">
                                        <FiFacebook strokeWidth={1.6} />
                                    </a>
                                    <a href="#" className="avatar-text avatar-sm">
                                        <FiTwitter />
                                    </a>
                                    <a href="#" className="avatar-text avatar-sm">
                                        <FiInstagram />
                                    </a>
                                    <a href="#" className="avatar-text avatar-sm">
                                        <FiLinkedin />
                                    </a>
                                    <a href="#" className="avatar-text avatar-sm">
                                        <FiGithub />
                                    </a>
                                </div>
                            </div>
                            <div className="lh-lg pt-3 pt-sm-0">
                                <h2 className="fs-4 fw-bold text-primary">Invoice</h2>
                                <div>
                                    <span className="fw-bold text-dark">Invoice: </span>
                                    <span className="fw-bold text-primary">#NXL369852</span>
                                </div>
                                <div>
                                    <span className="fw-bold text-dark">Due Date: </span>
                                    <span className="text-muted">28 Feb, 2023</span>
                                </div>
                                <div>
                                    <span className="fw-bold text-dark">Issued Date: </span>
                                    <span className="text-muted">25 JAN, 2023</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <hr className="border-dashed" />
                    <div className="px-4 py-sm-5">
                        <div className="d-sm-flex gap-4 justify-content-center">
                            <div className="text-sm-end">
                                <h2 className="fs-16 fw-bold text-dark mb-3">Invoiced To:</h2>
                                <address className="text-muted lh-lg">
                                    Ellen Louise Ripley<br />
                                    Nostromo PO Box 29618<br />
                                    VAT No: 295 3932 6119<br />
                                    United Kingdom
                                </address>
                            </div>
                            <div className="border-end border-end-dashed border-gray-500 d-none d-sm-block"></div>
                            <div className="mt-4 mt-sm-0">
                                <h2 className="fs-16 fw-bold text-dark mb-3">Payment Details:</h2>
                                <div className="text-muted lh-lg">
                                    <div>
                                        <span className="text-muted">Total Due:</span>
                                        <span className="fw-bold text-dark"> $249 USD</span>
                                    </div>
                                    <div>
                                        <span className="text-muted">Payout Status:</span>
                                        <span className="fw-bold text-warning"> Pending</span>
                                    </div>
                                    <div>
                                        <span className="text-muted">Card Holder:</span>
                                        <span className="fw-bold text-dark"> Alexandra Della</span>
                                    </div>
                                    <div>
                                        <span className="text-muted">Payment Method:</span>
                                        <span className="fw-bold text-dark"> Mastercard</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <hr className="border-dashed mb-0" />
                    <div className="table-responsive">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Service</th>
                                    <th>Description</th>
                                    <th>Rate</th>
                                    <th>QTY</th>
                                    <th>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {
                                    invoiceServiceData.map(({ description, name, price, quantity }, index) => (
                                        <tr key={index}>
                                            <td><a href="#">{name} </a></td>
                                            <td>{description}</td>
                                            <td>${price}</td>
                                            <td>{quantity}</td>
                                            <td className="text-dark fw-semibold">${quantity * price}</td>
                                        </tr>
                                    ))
                                }

                                <tr>
                                    <td colSpan="3"></td>
                                    <td className="fw-semibold text-dark bg-gray-100 text-lg-end">Sub Total</td>
                                    <td className="fw-bold text-dark bg-gray-100">+ ${subTotalPrice.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td colSpan="3"></td>
                                    <td className="fw-semibold text-dark bg-gray-100 text-lg-end">Discount (NXL2023 - 15%)</td>
                                    <td className="fw-bold text-success bg-gray-100">- ${discount.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td colSpan="3"></td>
                                    <td className="fw-semibold text-dark bg-gray-100 text-lg-end">Estimated Tax (12.5%)</td>
                                    <td className="fw-bold text-dark bg-gray-100">+ ${taxAmount.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td colSpan="3"></td>
                                    <td className="fw-semibold text-dark bg-gray-100 text-lg-end">Grand Amount</td>
                                    <td className="fw-bolder text-dark bg-gray-100">= ${(discountedPrice + taxAmount).toFixed(2)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <hr className="border-dashed mt-0" />
                    <div className="px-4">
                        <div className="alert alert-dismissible p-4 mt-3 alert-soft-warning-message" role="alert">
                            <button type="button" className="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                            <p className="mb-0">
                                <strong>NOTES:</strong> All accounts are to be paid within 7 days from receipt of invoice. <br />
                                To be paid by cheque or credit card or direct payment online. <br />
                                If account is not paid within 7 days the credits details supplied as confirmation of work undertaken will be charged the agreed quoted fee noted above.
                            </p>
                        </div>
                    </div>
                    <div className="px-4 pt-4 d-sm-flex align-items-center justify-content-between">
                        <div className="mb-5 mb-sm-0">
                            <h6 className="fs-13 fw-bold mb-3">Tarm &amp; Condition :</h6>
                            <ul className="list-unstyled lh-lg fs-12">
                                <li># All accounts are to be paid within 7 days from receipt of invoice.</li>
                                <li># To be paid by cheque or credit card or direct payment online.</li>
                                <li># If account is not paid within 7 days the credits details supplied as confirmation.</li>
                                <li># This is computer generated receipt and does not require physical signature.</li>
                            </ul>
                        </div>
                        <div className="text-center">
                            <img src="/images/general/signature.png" className="img-fluid wd-100" alt="image" />
                            <h6 className="fs-13 fw-bold mt-2">Account Manager</h6>
                            <p className="fs-11 fw-semibold text-muted">26 MAY 2024, 10:35PM</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default InvoiceView