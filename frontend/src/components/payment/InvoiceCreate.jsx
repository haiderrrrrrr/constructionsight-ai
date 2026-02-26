import React, { useState } from 'react'
import SelectDropdown from '@/components/shared/SelectDropdown'
import { currencyOptionsData } from '@/utils/fackData/currencyOptionsData'
import { FiCamera, FiInfo } from 'react-icons/fi'
import { BsCreditCardFill, BsPaypal } from 'react-icons/bs'
import { FaCcAmex, FaCcDinersClub, FaCcDiscover, FaCcJcb, FaCcMastercard, FaCcVisa } from 'react-icons/fa6'
import DatePicker from 'react-datepicker'
import useDatePicker from '@/hooks/useDatePicker'
import AddProposal from '../proposalEditCreate/AddProposal'
import useImageUpload from '@/hooks/useImageUpload'
import topTost from '@/utils/topTost'
import { invoiceTempletOptions } from './InvoiceView'
import Dropdown from '@/components/shared/Dropdown'

const previtems = [
    {
        id: 1,
        product: '',
        qty: 0,
        price: 0
    }
]
const InvoiceCreate = () => {
    const { startDate, endDate, setStartDate, setEndDate, renderFooter } = useDatePicker();
    const { handleImageUpload, uploadedImage } = useImageUpload()
    const [selectedOption, setSelectedOption] = useState(null)
    const [items, setItems] = useState(previtems);


    const addItem = () => {
        const newItem = {
            id: items.length + 1,
            product: '',
            qty: 1,
            price: 0
        };
        setItems([...items, newItem]);
    };

    const removeItem = () => {
        items.pop()

        setItems(items)
    }


    const handleInputChange = (id, field, value) => {
        const updatedItems = items.map(item => {
            if (item.id === id) {
                const updatedItem = { ...item, [field]: value };
                if (field === 'qty' || field === 'price') {
                    updatedItem.total = updatedItem.qty * updatedItem.price;
                }
                return updatedItem;
            }
            return item;
        });
        setItems(updatedItems);
    };

    const subTotal = items.reduce((accumulator, currentValue) => {
        return accumulator + (currentValue.price * currentValue.qty);
    }, 0);

    const vat = (subTotal * 0.1).toFixed(2)
    const vatNumber = Number(vat);
    const total = Number(subTotal + vatNumber).toFixed(2)

    const handleClick = () => {
        topTost()
    };
    return (
        <>
            <div className="col-xl-8">
                <div className="card invoice-container">
                    <div className="card-header">
                        <h5>Invoice Create</h5>
                        <Dropdown
                            dropdownItems={invoiceTempletOptions}
                            triggerClass='btn btn-light-brand dropdown-toggle'
                            triggerPosition={"0, 25"}
                            triggerText={"Invoice Templates"}
                            triggerIcon={" "}
                            isAvatar={false}
                            dropdownPosition='dropdown-menu-start'
                        />
                    </div>
                    <div className="card-body p-0">
                        <div className="px-4 pt-4">
                            <div className="d-md-flex align-items-center justify-content-between">
                                <div className="mb-4 mb-md-0 your-brand">
                                    <label htmlFor='img' className="wd-100 ht-100 mb-0 position-relative overflow-hidden border border-gray-2 rounded">
                                        <img src={uploadedImage || "/images/logo-abbr.png"} className="upload-pic img-fluid rounded h-100 w-100" alt="Uploaded" />
                                        <div className="position-absolute start-50 top-50 end-0 bottom-0 translate-middle h-100 w-100 hstack align-items-center justify-content-center c-pointer upload-button">
                                            <i aria-hidden="true" className='camera-icon'><FiCamera size={16} /></i>
                                        </div>
                                        <input className="file-upload" type="file" accept="image/*" id='img' hidden onChange={handleImageUpload} />
                                    </label>
                                    <div className="fs-12 text-muted">* Upload your brand</div>
                                </div>
                                <div className="d-md-flex align-items-center justify-content-end gap-4">
                                    <div className="form-group mb-3 mb-md-0">
                                        <label className="form-label">Issue Date:</label>
                                        <div className='input-group date '>
                                            <DatePicker
                                                placeholderText='Issue date...'
                                                selected={startDate}
                                                showPopperArrow={false}
                                                onChange={(date) => setStartDate(date)}
                                                className='form-control'
                                                popperPlacement="bottom-start"
                                                calendarContainer={({ children }) => (
                                                    <div className='bg-white react-datepicker'>
                                                        {children}
                                                        {renderFooter("start")}
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Due Date:</label>
                                        <div className='input-group date '>
                                            <DatePicker
                                                placeholderText='Due date...'
                                                selected={endDate}
                                                showPopperArrow={false}
                                                onChange={(date) => setEndDate(date)}
                                                className='form-control'
                                                popperPlacement="bottom-start"
                                                calendarContainer={({ children }) => (
                                                    <div className='bg-white react-datepicker'>
                                                        {children}
                                                        {renderFooter("end")}
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <hr className="border-dashed" />
                        <div className="px-4 row justify-content-between">
                            <div className="col-xl-3">
                                <div className="form-group mb-3">
                                    <label htmlFor="InvoiceLabel" className="form-label">Invoice Label</label>
                                    <input type="text" className="form-control" id="InvoiceLabel" placeholder="Duralux Invoice" />
                                </div>
                            </div>
                            <div className="col-xl-3">
                                <div className="form-group mb-3">
                                    <label htmlFor="InvoiceNumber" className="form-label">Invoice Number</label>
                                    <input type="text" className="form-control" id="InvoiceNumber" placeholder="#NXL2023" />
                                </div>
                            </div>
                            <div className="col-xl-6">
                                <div className="form-group mb-3">
                                    <label htmlFor="InvoiceProduct" className="form-label">Invoice Product</label>
                                    <input type="text" className="form-control" id="InvoiceProduct" placeholder="Product Name" />
                                </div>
                            </div>
                        </div>
                        <hr className="border-dashed" />
                        <div className="row px-4 justify-content-between">
                            <div className="col-xl-5 mb-4 mb-sm-0">
                                <div className="mb-4">
                                    <h6 className="fw-bold">Invoice From:</h6>
                                    <span className="fs-12 text-muted">Send an invoice and get paid</span>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="InvoiceName" className="col-sm-3 col-form-label">Name</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="InvoiceName" placeholder="Business Name" />
                                    </div>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="InvoiceEmail" className="col-sm-3 col-form-label">Email</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="InvoiceEmail" placeholder="Email Address" />
                                    </div>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="InvoicePhone" className="col-sm-3 col-form-label">Phone</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="InvoicePhone" placeholder="Enter Phone" />
                                    </div>
                                </div>
                                <div className="form-group row">
                                    <label htmlFor="InvoiceAddress" className="col-sm-3 col-form-label">Address</label>
                                    <div className="col-sm-9">
                                        <textarea rows={5} className="form-control" id="InvoiceAddress" placeholder="Enter Address" defaultValue={""} />
                                    </div>
                                </div>
                            </div>
                            <div className="col-xl-5">
                                <div className="mb-4">
                                    <h6 className="fw-bold">Invoice To:</h6>
                                    <span className="fs-12 text-muted">Send an invoice and get paid</span>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="ClientName" className="col-sm-3 col-form-label">Name</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="ClientName" placeholder="Business Name" />
                                    </div>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="ClientEmail" className="col-sm-3 col-form-label">Email</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="ClientEmail" placeholder="Email Address" />
                                    </div>
                                </div>
                                <div className="form-group row mb-3">
                                    <label htmlFor="ClientPhone" className="col-sm-3 col-form-label">Phone</label>
                                    <div className="col-sm-9">
                                        <input type="text" className="form-control" id="ClientPhone" placeholder="Enter Phone" />
                                    </div>
                                </div>
                                <div className="form-group row">
                                    <label htmlFor="ClientAddress" className="col-sm-3 col-form-label">Address</label>
                                    <div className="col-sm-9">
                                        <textarea rows={5} className="form-control" id="ClientAddress" placeholder="Enter Address" defaultValue={""} />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <hr className="border-dashed" />
                        <div className="px-4 clearfix proposal-table" >
                            <div className="mb-4 d-flex align-items-center justify-content-between">
                                <div>
                                    <h6 className="fw-bold">Add Items:</h6>
                                    <span className="fs-12 text-muted">Add items to invoice</span>
                                </div>
                                <div className="avatar-text avatar-sm" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Informations">
                                    <FiInfo />
                                </div>
                            </div>
                            <div className="table-responsive ">
                                <table className="table table-bordered overflow-hidden" id="tab_logic">
                                    <thead>
                                        <tr className="single-item">
                                            <th className="text-center">#</th>
                                            <th className="text-center wd-450">Product</th>
                                            <th className="text-center wd-150">Qty</th>
                                            <th className="text-center wd-150">Price</th>
                                            <th className="text-center wd-150">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {
                                            items.map(({ id, price, product, qty, total }, index) => {
                                                return (
                                                    <tr key={index}>
                                                        <td>{id}</td>
                                                        <td><input type="text" name="product" placeholder="Product Name" className="form-control" defaultValue={product} /></td>
                                                        <td><input type="number" name="qty" placeholder="Qty" className="form-control qty" step="1" min="1" defaultValue={qty} onChange={(e) => handleInputChange(id, 'qty', parseInt(e.target.value))} /></td>
                                                        <td><input type="number" name="price" placeholder="Unit Price" className="form-control price" step="1.00" min="1" defaultValue={price} onChange={(e) => handleInputChange(id, 'price', parseFloat(e.target.value))} /></td>
                                                        <td><input type="number" name="total" placeholder="0.00" className="form-control total" readOnly value={qty * price} /></td>
                                                    </tr>
                                                )
                                            })
                                        }
                                    </tbody>
                                </table>
                            </div>
                            <div className="d-flex justify-content-end gap-2 mt-3">
                                <button className="btn btn-sm bg-soft-danger text-danger" onClick={removeItem}>Delete</button>
                                <button className="btn btn-sm btn-primary" onClick={addItem}>Add Items</button>
                            </div>
                        </div>
                        <hr className="border-dashed" />
                        <div className="px-4 pb-4">
                            <div className="form-group">
                                <label htmlFor="InvoiceNote" className="form-label">Invoice Note:</label>
                                <textarea rows={6} className="form-control" id="InvoiceNote" placeholder="It was a pleasure working with you and your team. We hope you will keep us in mind for future freelance projects. Thank You!" defaultValue={""} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="col-xl-4">
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="mb-4 d-flex align-items-center justify-content-between">
                            <div>
                                <h6 className="fw-bold">Grand Total:</h6>
                                <span className="fs-12 text-muted">Grand total invoice</span>
                            </div>
                            <div className="avatar-text avatar-sm" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Grand total invoice">
                                <FiInfo />
                            </div>
                        </div>
                        <div className="table-responsive">
                            <table className="table table-bordered" id="tab_logic_total">
                                <tbody>
                                    <tr className="single-item">
                                        <th className="fs-10 text-dark text-uppercase">Sub Total</th>
                                        <td className="w-25"><input type="number" name="sub_total" placeholder="0.00" className="form-control border-0 bg-transparent p-0" id="sub_total" readOnly value={subTotal} /></td>
                                    </tr>
                                    <tr className="single-item">
                                        <th className="fs-10 text-dark text-uppercase">Tax</th>
                                        <td className="w-25">
                                            <div className="input-group mb-2 mb-sm-0">
                                                <input type="number" className="form-control border-0 bg-transparent p-0" id="tax" placeholder="0" defaultValue="10" />
                                                <div className="input-group-addon">%</div>
                                            </div>
                                        </td>
                                    </tr>
                                    <tr className="single-item">
                                        <th className="fs-10 text-dark text-uppercase">Tax Amount</th>
                                        <td className="w-25"><input type="number" name="tax_amount" id="tax_amount" placeholder="0.00" className="form-control border-0 bg-transparent p-0" readOnly value={vat} /></td>
                                    </tr>
                                    <tr className="single-item">
                                        <th className="fs-10 text-dark text-uppercase bg-gray-100">Grand Total</th>
                                        <td className="bg-gray-100 w-25"><input type="number" name="total_amount" id="total_amount" placeholder="0.00" className="form-control border-0 bg-transparent p-0 fw-700 text-dark" readOnly value={total} /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="mb-4 d-flex align-items-center justify-content-between">
                            <div>
                                <h6 className="fw-bold">Payment Methord:</h6>
                                <span className="fs-12 text-muted">Select payment methord</span>
                            </div>
                            <div className="avatar-text avatar-sm" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Select payment methord">
                                <FiInfo />
                            </div>
                        </div>
                        {/* Nav tabs */}
                        <ul className="nav nav-justified gap-1">
                            <li className="nav-item border border-gray-500">
                                <a href="#" className="nav-link px-2 active d-flex align-items-center justify-content-center" data-bs-toggle="tab" data-bs-target="#pamymetDebitCardTab">
                                    <BsCreditCardFill />
                                    <span className="ms-2">Debit Card</span>
                                </a>
                            </li>
                            <li className="nav-item border border-gray-500">
                                <a href="#" className="nav-link px-2 d-flex align-items-center justify-content-center" data-bs-toggle="tab" data-bs-target="#pamymetPaypalTab">
                                    <BsPaypal />
                                    <span className="ms-2">Paypal</span>
                                </a>
                            </li>
                        </ul>
                        {/* Tab panes */}
                        <div className="tab-content mt-4">
                            <div className="tab-pane fade show active" id="pamymetDebitCardTab" role="tabpanel">
                                <div className="form-group mb-3">
                                    <input type="text" className="form-control input-credit-card" placeholder="Card Number" />
                                    <div className="hstack justify-content-end gap-1 mt-1 input-credit-card-type">
                                        <div className="amex">
                                            <FaCcAmex size={13} />
                                        </div>
                                        <div className="mastercard">
                                            <FaCcMastercard size={13} />
                                        </div>
                                        <div className="visa">
                                            <FaCcVisa size={13} />
                                        </div>
                                        <div className="discover">
                                            <FaCcDiscover size={13} />
                                        </div>
                                        <div className="jcb">
                                            <FaCcJcb size={13} />
                                        </div>
                                        <div className="diners">
                                            <FaCcDinersClub size={13} />
                                        </div>
                                    </div>
                                </div>
                                <div className="form-group mb-3">
                                    <input type="text" className="form-control" placeholder="Card Holder Name" />
                                </div>
                                <div className="d-flex gap-3">
                                    <div className="form-group">
                                        <input type="text" className="form-control input-date-formatting" placeholder="MM/YYYY" />
                                    </div>
                                    <div className="form-group">
                                        <input type="text" className="form-control input-Blocks-formatting" placeholder={686} />
                                    </div>
                                </div>
                            </div>
                            <div className="tab-pane fade" id="pamymetPaypalTab" role="tabpanel">
                                <p>Paypal is easiest way to pay online</p>
                                <p>
                                    <a href="http://paypal.com" target="_blank" className="btn btn-primary"><i className="bi bi-paypal me-2" /> Log in my Paypal</a>
                                </p>
                                <div className="fs-11 text-muted">Note: There are many variations of passages of Lorem Ipsum available, but the majority have suffered alteration in some form, by injected humour, or randomised words.</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="mb-4 d-flex align-items-center justify-content-between">
                            <div>
                                <h6 className="fw-bold">Currency &amp; Discount:</h6>
                                <span className="fs-12 text-muted">Calculate your currency, tax &amp; discount</span>
                            </div>
                            <div className="avatar-text avatar-sm" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Calculate your currency, tax & discount">
                                <FiInfo />
                            </div>
                        </div>
                        <div className="form-group mb-4">
                            <SelectDropdown
                                options={currencyOptionsData}
                                selectedOption={selectedOption}
                                defaultSelect="usd"
                                onSelectOption={(option) => setSelectedOption(option)}
                            />
                        </div>
                        <div className="form-group mb-4">
                            <input type="number" id="itemDiscount" className="form-control" placeholder="Discount" />
                        </div>
                        <div className="ps-0 mb-3 form-check form-switch form-switch-sm d-flex align-center justify-content-between">
                            <label className="fw-bold text-dark" htmlFor="LateFees">
                                <span>Late Fees</span>
                                <span className="fs-11 fw-normal text-muted d-block">Late fees for extra charge</span>
                            </label>
                            <input className="form-check-input" type="checkbox" id="LateFees" defaultChecked="checked" />
                        </div>
                        <div className="ps-0 mb-3 form-check form-switch form-switch-sm d-flex align-center justify-content-between">
                            <label className="fw-bold text-dark" htmlFor="ClientNote">
                                <span>Client Notes</span>
                                <span className="fs-11 fw-normal text-muted d-block">Client notes for further query</span>
                            </label>
                            <input className="form-check-input" type="checkbox" id="ClientNote" />
                        </div>
                        <div className="ps-0 form-check form-switch form-switch-sm d-flex align-center justify-content-between">
                            <label className="fw-bold text-dark" htmlFor="SavePayment">
                                <span>Save Payment</span>
                                <span className="fs-11 fw-normal text-muted d-block">Save payment for quick payout</span>
                            </label>
                            <input className="form-check-input" type="checkbox" id="SavePayment" />
                        </div>
                    </div>
                </div>
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="mb-4 d-flex align-items-center justify-content-between">
                            <div>
                                <h6 className="fw-bold">Cancel Invoce</h6>
                                <span className="fs-12 text-muted">Cancel invoice for ever.</span>
                            </div>
                            <a href="#" className="btn btn-light-brand">Nevermind</a>
                        </div>
                        <p className="fs-12 text-muted mb-4">Are you sure you want to cancel this invoice? Neigther you nor alex will able to make any(more) payments on it.</p>
                        <div className="custom-control custom-checkbox">
                            <input type="checkbox" className="custom-control-input" id="notifyMe" defaultChecked />
                            <label className="custom-control-label c-pointer" htmlFor="notifyMe">Notify alex that this invoice was cancelled.</label>
                        </div>
                        <a href="#" className="btn bg-soft-danger text-danger mt-4" onClick={handleClick}>Cancel this Invoice</a>
                    </div>
                </div>
            </div>
        </>
    )
}

export default InvoiceCreate