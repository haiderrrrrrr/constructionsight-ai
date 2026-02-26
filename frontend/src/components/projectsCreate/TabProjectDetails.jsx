import React, { useEffect, useRef, useState } from 'react'
import { FiFolder, FiBriefcase, FiCalendar, FiAlertCircle } from 'react-icons/fi'

import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '@/styles/react-datepicker-theme.css'
import { SelectDropdown } from '@/components/shared/Dropdown'

export const PAKISTAN_CITIES = [
    'Abbas Kili','Abbottabad','Abdullahabad','Adilpur','Ahmadpur East','Ahmadpur Sial',
    'Akora','Aliabad','Alipur','Alizai','Allahabad','Aman Garh','Arifwala',
    'Attock City','Attock Khurd','Awaran',
    'Badin','Baffa','Bagarji','Bagh','Bahawalpur','Bahawalnagar','Bakhri Ahmad Khan',
    'Bandhi','Bannu','Barkhan','Basirpur','Bat Khela','Battagram','Bela','Bhag',
    'Bhakkar','Bhalwal','Bhawana','Bhera','Bhimbar','Bhiria','Bhit Shah','Bhopalwala',
    'Bulri','Burewala',
    'Chak','Chakwal','Chaman','Charsadda','Chawinda','Chichawatni','Chilas','Chiniot',
    'Chishtian','Chitral','Choa Saidan Shah','Chhor','Chunian','Chuchar-kana Mandi',
    'Chuhar Jamali',
    'Dadhar','Dadu','Daggar','Daira Din Panah','Dajal','Dalbandin','Darya Khan',
    'Daska Kalan','Daud Khel','Daulatpur','Daultala','Daur','Dera Bugti',
    'Dera Ghazi Khan','Dera Ismail Khan','Dera Murad Jamali','Digri','Dijkot',
    'Dinga','Dipalpur','Diplo','Dokri','Duki','Dullewala','Dunga Bunga','Dunyapur',
    'Eminabad',
    'Faisalabad','Faqirwali','Faruka','Fazilpur','Fort Abbas',
    'Gadani','Gakuch','Gambat','Gandava','Garhi Khairo','Garhiyasin','Garangwala',
    'Gharo','Ghauspur','Ghotki','Gilgit','Gojra','Gujar Khan','Gujranwala','Gujrat',
    'Gwadar',
    'Hadali','Hafizabad','Hala','Hangu','Haripur','Harnai','Harunabad','Hasilpur',
    'Havelian','Haveli Lakha','Hazro City','Hingorja','Hub','Hujra Shah Muqim',
    'Hyderabad',
    'Islamabad','Islamkot',
    'Jacobabad','Jalalpur Jattan','Jalalpur Pirwala','Jand','Jampur','Jamshoro',
    'Jaranwala','Jatoi Shimali','Jauharabad','Jhang City','Jhang Sadr','Jhawarian',
    'Jhelum','Jiwani','Johi',
    'Kabirwala','Kadhan','Kahna Nau','Kahror Pakka','Kahuta','Kalabagh','Kalam',
    'Kalat','Kaleke Mandi','Kallar Kahar','Kalur Kot','Kamalia','Kambar','Kamoke',
    'Kamra','Kandhkot','Kandiaro','Kanganpur','Karak','Karachi','Karor','Kashmor',
    'Kasur','Khairpur','Khanewal','Khapalu','Kharian','Khewra','Khipro',
    'Khanpur','Khanpur Mahar','Khangarh','Khuzdar','Kohat','Kohlu','Kot Addu',
    'Kot Diji','Kot Ghulam Muhammad','Kot Malik Barkhurdar','Kot Mumin',
    'Kot Radha Kishan','Kot Samaba','Kot Sultan','Kotli','Kotri','Kulachi',
    'Kundian','Kunjah','Kunri','Khushab',
    'Lachi','Lahore','Lala Musa','Lalian','Landi Kotal','Larkana','Layyah',
    'Liliani','Lodhran','Loralai',
    'Mach','Madeji','Mailsi','Malakand','Malakwal','Mamu Kanjan','Mananwala',
    'Mandi Bahauddin','Mangla','Mankera','Mansehra','Mardan','Mastung','Matiari',
    'Matli','Mehar','Mehrabpur','Mian Channun','Mianwali','Minchianabad','Mingora',
    'Miran Shah','Miro Khan','Mirpur','Mirpur Khas','Mirpur Mathelo','Mirpur Sakro',
    'Mithi','Mitha Tiwana','Moro','Muridke','Murree','Multan','Muzaffargarh',
    'Muzaffarabad',
    'Nabisar','Nankana Sahib','Narang Mandi','Narowal','Nasirabad','Naudero',
    'Naukot','Naushahra','Naushahra Virkan','Naushahro Firoz','Nawabshah',
    'New Mirpur','Nowshera','Nushki',
    'Okara','Ormara',
    'Pabbi','Pad Idan','Paharpur','Pakpattan','Palandri','Panjgur','Pano Aqil',
    'Pasni','Pasrur','Pattoki','Peshawar','Phalia','Pind Dadan Khan',
    'Pindi Bhattian','Pindi Gheb','Pir Jo Goth','Pir Mahal','Pishin','Pithoro',
    'Qadirpur Ran','Qila Abdullah','Qila Saifullah','Quetta',
    'Rahim Yar Khan','Rajanpur','Raiwind','Raja Jang','Ranipur','Rasulnagar',
    'Ratodero','Rawalpindi','Rawala Kot','Renala Khurd','Rohri','Rojhan','Rustam',
    'Sadabad','Saddiqabad','Saidu Sharif','Sahiwal','Sakrand','Samaro','Sambrial',
    'Samungli','Sanghar','Sangla Hill','Sann','Sarai Alamgir','Sarai Naurang',
    'Sarai Sidhu','Sargodha','Sehwan','Shahr Sultan','Shahdad Kot','Shahdadpur',
    'Shahpur','Shahpur Chakar','Shakargarh','Sharqpur Sharif','Shabqadar',
    'Shekhupura','Shikarpur','Shorkot','Sialkot','Sibi','Sillanwali','Sinjhoro',
    'Skardu','Sobhodero','Sohbatpur','Sukkur','Surab','Swabi',
    'Talagang','Talamba','Talhar','Tandlianwala','Tando Adam','Tando Allahyar',
    'Tando Bago','Tando Jam','Tando Mitha Khan','Tando Muhammad Khan','Tangwani',
    'Tank','Tangi','Taunsa','Thatta','Thul','Timargara','Toba Tek Singh','Topi',
    'Turbat',
    'Ubauro','Umarkot','Uthal','Utmanzai',
    'Vihari','Wah','Wana','Warah','Wazirabad',
    'Yazman',
    'Zafarwal','Zahir Pir','Ziarat','Zhob',
].sort()

const LABEL = "fs-11 fw-semibold text-muted text-uppercase mb-1"
const LABEL_STYLE = { letterSpacing: '0.06em' }

const TabProjectDetails = ({ formData, setFormData, errors = {}, setErrors = () => {} }) => {
    const startDateRef = useRef(null);
    const endDateRef = useRef(null);
    const startPointerRef = useRef(false)
    const endPointerRef = useRef(false)
    const [isStartCalendarOpen, setIsStartCalendarOpen] = useState(false)
    const [isEndCalendarOpen, setIsEndCalendarOpen] = useState(false)
    const [isDarkTheme, setIsDarkTheme] = useState(() => document.documentElement.classList.contains('app-skin-dark'))

    useEffect(() => {
        const el = document.documentElement
        const updateTheme = () => setIsDarkTheme(el.classList.contains('app-skin-dark'))
        updateTheme()

        const observer = new MutationObserver((mutations) => {
            if (!mutations.some((m) => m.type === 'attributes' && m.attributeName === 'class')) return
            updateTheme()
        })
        observer.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!isStartCalendarOpen && !isEndCalendarOpen) return

        if (isStartCalendarOpen) {
            setIsStartCalendarOpen(false)
            setTimeout(() => setIsStartCalendarOpen(true), 0)
        }
        if (isEndCalendarOpen) {
            setIsEndCalendarOpen(false)
            setTimeout(() => setIsEndCalendarOpen(true), 0)
        }
    }, [isDarkTheme])

    const parseISODate = (value) => {
        if (!value) return null
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
        if (!match) return null
        const year = Number(match[1])
        const monthIndex = Number(match[2]) - 1
        const day = Number(match[3])
        const date = new Date(year, monthIndex, day)
        if (Number.isNaN(date.getTime())) return null
        if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null
        return date
    }

    const formatISODate = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    const dateTemplate = 'YYYY-MM-DD'

    const maskISODateGuide = (raw) => {
        const digits = String(raw || '').replace(/\D/g, '').slice(0, 8)
        const chars = dateTemplate.split('')
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        for (let i = 0; i < digits.length; i += 1) {
            chars[slots[i]] = digits[i]
        }
        return { masked: chars.join(''), digitsCount: digits.length }
    }

    // Enterprise strict cursor positioning - always goes to next empty digit slot
    const setMaskedCaret = (id, digitsCount) => {
        const el = document.getElementById(id)
        if (!el?.setSelectionRange) return
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        const clampedCount = Math.min(digitsCount, slots.length)
        const caret = clampedCount >= slots.length ? 10 : slots[clampedCount]
        try {
            el.setSelectionRange(caret, caret)
        } catch { }
    }

    // Get position of next empty digit slot (for focus jump)
    const getNextEmptySlot = (digitsCount) => {
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        return digitsCount >= slots.length ? 10 : slots[digitsCount]
    }

    // Handle strict arrow key navigation - prevent moving outside digit slots
    const handleDateKeyDown = (e, fieldId) => {
        const slots = [0, 1, 2, 3, 5, 6, 8, 9]
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return

        const el = document.getElementById(fieldId)
        if (!el) return

        const currentPos = el.selectionStart
        // Allow only movement within digit slots, prevent staying on dashes
        if (e.key === 'ArrowLeft') {
            const prevSlot = slots.findLast(s => s < currentPos)
            if (prevSlot !== undefined) {
                e.preventDefault()
                el.setSelectionRange(prevSlot, prevSlot)
            }
        } else if (e.key === 'ArrowRight') {
            const nextSlot = slots.find(s => s > currentPos)
            if (nextSlot !== undefined) {
                e.preventDefault()
                el.setSelectionRange(nextSlot, nextSlot)
            }
        }
    }

    // Smart focus handler - always jump to first empty digit position
    const handleDateFocus = (fieldId, currentValue) => {
        requestAnimationFrame(() => {
            const { digitsCount } = maskISODateGuide(currentValue)
            const nextSlot = getNextEmptySlot(digitsCount)
            const el = document.getElementById(fieldId)
            if (el) el.setSelectionRange(nextSlot, nextSlot)
        })
    }

    // Auto-pad MM and DD with leading zero on blur
    const autoPadDate = (value) => {
        if (!value) return value

        const { masked, digitsCount } = maskISODateGuide(value)

        // If 5 digits: YYYY + single M → pad MM
        if (digitsCount === 5) {
            const digits = String(value).replace(/\D/g, '')
            const yyyy = digits.slice(0, 4)
            const m = digits[4]
            return `${yyyy}-0${m}-MM`
        }

        // If 7 digits: YYYY + MM + single D → pad DD
        if (digitsCount === 7) {
            const digits = String(value).replace(/\D/g, '')
            const yyyy = digits.slice(0, 4)
            const mm = digits.slice(4, 6)
            const d = digits[6]
            return `${yyyy}-${mm}-0${d}`
        }

        return masked
    }

    const update = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    };

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} style={{ flexShrink: 0 }} />{errors[field]}
        </span>
    ) : <span />;

    return (
        <section className="step-body mt-4 body current">
            <style>{`
                .field-error svg{stroke:#ef4444!important;color:#ef4444!important;}
            `}</style>

            <form id="project-details">
                <fieldset>
                    <div className="mb-5 text-center">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)', color: 'var(--bs-primary)', border: '1px solid rgba(var(--bs-primary-rgb),0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)' }}>Configuration</div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Project Details</h2>
                        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Define core project information such as name, location, timeline and description</p>
                    </div>

                    <fieldset>
                        {/* Project Name */}
                        <div className="mb-4">
                            <label htmlFor="projectName" className={LABEL} style={LABEL_STYLE}>
                                Project Name <span className="text-danger">*</span>
                            </label>
                            <div className="input-group">
                                <div className="input-group-text"><FiFolder size={15} /></div>
                                <input
                                    type="text"
                                    className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                                    id="projectName"
                                    placeholder="Enter project name"
                                    style={{ fontSize: '0.875rem' }}
                                    value={formData.name || ''}
                                    onChange={e => update("name", e.target.value)}
                                    maxLength={200}
                                />
                            </div>
                            <div className="d-flex justify-content-between mt-1">
                                <FieldError field="name" />
                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>{(formData.name || '').length}/200</span>
                            </div>
                        </div>


                        {/* Site Location */}
                        <div className="mb-4">
                            <label htmlFor="projectLocation" className={LABEL} style={LABEL_STYLE}>
                                Site Location <span className="text-danger">*</span>
                            </label>
                            <SelectDropdown
                                id="projectLocation"
                                value={formData.location || ''}
                                invalid={!!errors.location}
                                placeholder="Select a city"
                                options={PAKISTAN_CITIES.map(city => ({ value: city, label: city }))}
                                onChange={(v) => update("location", v)}
                                enableSearch={true}
                                searchPlaceholder="Search city…"
                                noResultsText="No cities found"
                                menuPosition="end"
                                buttonStyle={{ fontSize: '0.875rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            />
                            <div className="mt-1">
                                <FieldError field="location" />
                            </div>
                        </div>

                        {/* Client Name */}
                        <div className="mb-4">
                            <label htmlFor="clientName" className={LABEL} style={LABEL_STYLE}>
                                Client Name <span className="text-danger">*</span>
                            </label>
                            <div className="input-group">
                                <div className="input-group-text"><FiBriefcase size={15} /></div>
                                <input
                                    type="text"
                                    className={`form-control ${errors.client_name ? 'is-invalid' : ''}`}
                                    id="clientName"
                                    placeholder="Enter client or organization name"
                                    style={{ fontSize: '0.875rem' }}
                                    value={formData.client_name || ''}
                                    onChange={e => update("client_name", e.target.value)}
                                    maxLength={200}
                                />
                            </div>
                            <div className="d-flex justify-content-between mt-1">
                                {errors.client_name && <FieldError field="client_name" />}
                                <span className="text-muted ms-auto" style={{ fontSize: '0.72rem' }}>{(formData.client_name || '').length}/200</span>
                            </div>
                        </div>

                        {/* Start Date + End Date */}
                        <div className="row g-3 mb-4">
                            <div className="col-md-6">
                                <label htmlFor="startDate" className={LABEL} style={LABEL_STYLE}>
                                    Start Date <span className="text-danger">*</span>
                                </label>
                                <div className="input-group" style={{ position: 'relative' }}>
                                    <div
                                        className="input-group-text"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => setIsStartCalendarOpen(true)}
                                        title="Open calendar"
                                    >
                                        <FiCalendar size={15} />
                                    </div>
                                    <DatePicker
                                        id="startDate"
                                        selected={parseISODate(formData.start_date)}
                                        value={formData.start_date ? formData.start_date : dateTemplate}
                                        onChange={(date) => {
                                            update("start_date", date ? formatISODate(date) : '')
                                            setIsStartCalendarOpen(false)
                                        }}
                                        onChangeRaw={(e) => {
                                            const { masked, digitsCount } = maskISODateGuide(e.target.value)
                                            update("start_date", digitsCount === 0 ? '' : masked)
                                            requestAnimationFrame(() => {
                                                // Auto-advance cursor after MM/DD complete
                                                const slots = [0, 1, 2, 3, 5, 6, 8, 9]
                                                let caret = slots[digitsCount] ?? 10

                                                // If just completed MM (6 digits), jump to DD start
                                                if (digitsCount === 6) caret = slots[6] // Position 8 (DD start)
                                                // If completed YYYY (4 digits), jump to MM start
                                                if (digitsCount === 4) caret = slots[4] // Position 5 (MM start)

                                                const el = document.getElementById('startDate')
                                                if (el) el.setSelectionRange(caret, caret)
                                            })
                                        }}
                                        dateFormat="yyyy-MM-dd"
                                        placeholderText="YYYY-MM-DD"
                                        className={`form-control cs-date-input ${errors.start_date ? 'is-invalid' : ''}`}
                                        ref={startDateRef}
                                        open={isStartCalendarOpen}
                                        onInputClick={() => { startPointerRef.current = true }}
                                        onClickOutside={() => setIsStartCalendarOpen(false)}
                                        onCalendarClose={() => setIsStartCalendarOpen(false)}
                                        onFocus={() => {
                                            if (startPointerRef.current) {
                                                startPointerRef.current = false
                                                return
                                            }
                                            handleDateFocus('startDate', formData.start_date)
                                        }}
                                        onKeyDown={(e) => handleDateKeyDown(e, 'startDate')}
                                        onBlur={() => {
                                            if ((formData.start_date || '').trim().toUpperCase() === dateTemplate) {
                                                update('start_date', '')
                                            } else if (formData.start_date) {
                                                const padded = autoPadDate(formData.start_date)
                                                if (padded !== formData.start_date) {
                                                    update('start_date', padded)
                                                }
                                            }
                                        }}
                                        popperClassName={isDarkTheme ? 'react-datepicker-dark' : ''}
                                    />
                                </div>
                                {errors.start_date && <div className="mt-1"><FieldError field="start_date" /></div>}
                            </div>
                            <div className="col-md-6">
                                <label htmlFor="endDate" className={LABEL} style={LABEL_STYLE}>
                                    End Date <span className="text-danger">*</span>
                                </label>
                                <div className="input-group" style={{ position: 'relative' }}>
                                    <div
                                        className="input-group-text"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => setIsEndCalendarOpen(true)}
                                        title="Open calendar"
                                    >
                                        <FiCalendar size={15} />
                                    </div>
                                    <DatePicker
                                        id="endDate"
                                        selected={parseISODate(formData.end_date)}
                                        value={formData.end_date ? formData.end_date : dateTemplate}
                                        onChange={(date) => {
                                            update("end_date", date ? formatISODate(date) : '')
                                            setIsEndCalendarOpen(false)
                                        }}
                                        onChangeRaw={(e) => {
                                            const { masked, digitsCount } = maskISODateGuide(e.target.value)
                                            update("end_date", digitsCount === 0 ? '' : masked)
                                            requestAnimationFrame(() => {
                                                // Auto-advance cursor after MM/DD complete
                                                const slots = [0, 1, 2, 3, 5, 6, 8, 9]
                                                let caret = slots[digitsCount] ?? 10

                                                // If just completed MM (6 digits), jump to DD start
                                                if (digitsCount === 6) caret = slots[6] // Position 8 (DD start)
                                                // If completed YYYY (4 digits), jump to MM start
                                                if (digitsCount === 4) caret = slots[4] // Position 5 (MM start)

                                                const el = document.getElementById('endDate')
                                                if (el) el.setSelectionRange(caret, caret)
                                            })
                                        }}
                                        dateFormat="yyyy-MM-dd"
                                        placeholderText="YYYY-MM-DD"
                                        className={`form-control cs-date-input ${errors.end_date ? 'is-invalid' : ''}`}
                                        ref={endDateRef}
                                        open={isEndCalendarOpen}
                                        onInputClick={() => { endPointerRef.current = true }}
                                        onClickOutside={() => setIsEndCalendarOpen(false)}
                                        onCalendarClose={() => setIsEndCalendarOpen(false)}
                                        onFocus={() => {
                                            if (endPointerRef.current) {
                                                endPointerRef.current = false
                                                return
                                            }
                                            handleDateFocus('endDate', formData.end_date)
                                        }}
                                        onKeyDown={(e) => handleDateKeyDown(e, 'endDate')}
                                        onBlur={() => {
                                            if ((formData.end_date || '').trim().toUpperCase() === dateTemplate) {
                                                update('end_date', '')
                                            } else if (formData.end_date) {
                                                const padded = autoPadDate(formData.end_date)
                                                if (padded !== formData.end_date) {
                                                    update('end_date', padded)
                                                }
                                            }
                                        }}
                                        popperClassName={isDarkTheme ? 'react-datepicker-dark' : ''}
                                    />
                                </div>
                                {errors.end_date && <div className="mt-1"><FieldError field="end_date" /></div>}
                            </div>
                        </div>

                        {/* Project Description */}
                        <div className="mb-4">
                            <label htmlFor="description" className={LABEL} style={LABEL_STYLE}>
                                Project Description <span className="text-danger">*</span>
                            </label>
                            <textarea
                                className={`form-control ${errors.description ? 'is-invalid' : ''}`}
                                id="description"
                                rows={16}
                                placeholder="Enter a brief summary of the project scope and objectives"
                                style={{ fontSize: '0.875rem', resize: 'none', padding: '10px 12px', minHeight: 320 }}
                                value={formData.description || ''}
                                onChange={e => update("description", e.target.value)}
                                maxLength={2000}
                            />
                            <div className="d-flex justify-content-between mt-1">
                                <FieldError field="description" />
                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>{(formData.description || '').length}/2000</span>
                            </div>
                        </div>

                    </fieldset>
                </fieldset>
            </form>
        </section>
    );
};

export default TabProjectDetails
