import React, { useEffect, useState } from 'react'
import { FiCheck } from 'react-icons/fi'
import helpTopicsContent from '@/utils/helpTopicsContent'

const SupportDetails = () => {
    const [activeTopic, setActiveTopic] = useState(null)
    const bodyRef = React.useRef(null)

    useEffect(() => {
        const handler = (e) => setActiveTopic(e.detail)
        window.addEventListener('cs:help-topic-open', handler)
        return () => window.removeEventListener('cs:help-topic-open', handler)
    }, [])

    useEffect(() => {
        if (activeTopic && bodyRef.current) {
            bodyRef.current.scrollTop = 0
        }
    }, [activeTopic])

    const content = activeTopic ? helpTopicsContent[activeTopic.title] : null

    return (
        <div className="offcanvas offcanvas-end topics-details-offcanvas" tabIndex={-1} id="topicsDetailsOffcanvas" aria-labelledby="topicsDetailsOffcanvas">
            <div className="offcanvas-header border-bottom px-4">
                <div className="d-none d-sm-flex align-items-center">
                    <a href="#">Help Center</a>
                    {content && (
                        <>
                            <span className="mx-2 text-muted">/</span>
                            <a href="#">{content.category}</a>
                            <span className="mx-2 text-muted">/</span>
                            <span className="text-muted">{activeTopic?.title}</span>
                        </>
                    )}
                </div>
                <button type="button" className="btn-close text-reset" data-bs-dismiss="offcanvas" aria-label="Close" />
            </div>

            <div className="offcanvas-body" ref={bodyRef}>
                {!content ? (
                    <div className="p-lg-5 mx-lg-5 text-center text-muted mt-5">
                        <p className="fs-14">Select a topic from the knowledge base to view its guide here.</p>
                    </div>
                ) : (
                    <div className="p-lg-5 mx-lg-3 help-center details-content-body">
                        <h2 className="fs-18 fw-bold">{activeTopic.title}</h2>
                        <div className="mt-2">
                            <span className="badge bg-soft-warning text-warning text-uppercase">{content.category}</span>
                        </div>
                        <hr className="my-4" />

                        <p className="text-muted">{content.intro}</p>

                        {content.steps && content.steps.length > 0 && (
                            <div className="mt-4">
                                <h4 className="fs-14 fw-semibold mb-3">Steps</h4>
                                <ol className="text-muted ps-3">
                                    {content.steps.map((step, i) => (
                                        <li key={i} className="mb-2">{step}</li>
                                    ))}
                                </ol>
                            </div>
                        )}

                        {content.points && content.points.length > 0 && (
                            <div className="mt-4">
                                <style>{`
                                    .cs-help-kp-icon { display: inline-flex; align-items: center; justify-content: center; }
                                    .cs-help-kp-icon svg { position: relative; top: -0.5px; }
                                `}</style>
                                <h4 className="fs-14 fw-semibold mb-3">Key Points</h4>
                                <ul className="list-unstyled">
                                    {content.points.map((point, i) => (
                                        <li key={i} className="d-flex align-items-start mb-2">
                                            <span className="avatar-text avatar-sm bg-soft-success text-success me-2 flex-shrink-0 cs-help-kp-icon">
                                                <FiCheck size={10} />
                                            </span>
                                            <span className="text-muted">{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {content.note && (
                            <div className="mt-4 p-3 bg-gray-100 rounded-3">
                                <p className="fs-12 text-muted mb-0">
                                    <strong className="text-dark">Note: </strong>{content.note}
                                </p>
                            </div>
                        )}

                        <hr className="my-5" />

                        <div className="w-100 p-4 bg-gray-100 text-center rounded-3">
                            <h2 className="fs-15 mb-2">Still need help?</h2>
                            <p className="text-muted fs-12">Contact our support team directly and we will get back to you.</p>
                            <div className="d-flex justify-content-center gap-2">
                                <a href="https://wa.me/923035120027" target="_blank" rel="noreferrer" className="btn btn-sm btn-success">WhatsApp Us</a>
                                <a href="mailto:constructionsightai@gmail.com" className="btn btn-sm btn-primary">Email Support</a>
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </div>
    )
}

export default SupportDetails
