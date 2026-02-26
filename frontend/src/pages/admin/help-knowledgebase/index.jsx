
import React, { useEffect, useRef, useState } from 'react'
import HelpBanner from '@/components/helpBanner';
import { FiArrowRight, FiFileText, FiAlertCircle } from 'react-icons/fi';
import helpTopicsContent from '@/utils/helpTopicsContent';

const categoryData = [
    {
        title: 'Getting Started',
        icon: '/images/icons/line-icon/safe.png',
        topics: ['Creating your first project', 'Inviting a Project Manager', 'Accepting a PM invitation', 'Understanding the setup wizard', 'Project lifecycle overview'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 6
    },
    {
        title: 'Camera Management',
        icon: '/images/icons/line-icon/mexican.png',
        topics: ['Registering a new camera', 'Configuring RTSP credentials', 'Setting up ONVIF connection', 'Running a camera health check', 'Archiving and restoring cameras'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 8
    },
    {
        title: 'Project Management',
        icon: '/images/icons/line-icon/shield.png',
        topics: ['Moving project from DRAFT to ACTIVE', 'Editing project details', 'Archiving and unarchiving a project', 'Deleting a DRAFT project', 'Understanding project status rules'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 9
    },
    {
        title: 'Team & Roles',
        icon: '/images/icons/line-icon/money-bag.png',
        topics: ['Admin vs Project Manager roles', 'Inviting team members by email', 'Resending an expired invitation', 'Removing a team member', 'Managing project memberships'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 10
    },
    {
        title: 'Live Monitoring',
        icon: '/images/icons/line-icon/lifebuoy.png',
        topics: ['Viewing live camera feeds', 'Camera health check scheduler', 'Configuring scheduler interval', 'Monitoring camera sites', 'Understanding health check results'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 8
    },
    {
        title: 'Troubleshooting',
        icon: '/images/icons/line-icon/award.png',
        topics: ['Camera showing as offline', 'Invitation link expired or invalid', 'Project stuck in SETUP_IN_PROGRESS', '401 Unauthorized errors explained', 'Cannot edit or delete a project'],
        moreTopicsLink: 'More Topics →',
        totalTopic: 7
    },
];

const trandingData = [
    { title: 'How do I invite a Project Manager to a project?' },
    { title: 'Why is my camera showing as offline or unreachable?' },
    { title: 'How do I move a project from DRAFT to ACTIVE?' },
    { title: 'How do I resend an expired PM invitation?' },
    { title: 'Can I delete a project that is already ACTIVE?' },
    { title: 'How do I configure RTSP credentials for a camera?' },
    { title: 'Why can\'t I edit my project details anymore?' }
];

const questionData = [
    {
        title: '+92 303 5120027',
        icon: '/images/icons/line-icon/phone.png',
        link: 'https://wa.me/923035120027',
        description: 'We are always happy to help.'
    },
    {
        title: 'constructionsightai@gmail.com',
        icon: '/images/icons/line-icon/email.png',
        link: 'mailto:constructionsightai@gmail.com',
        description: 'The best way to get answers faster.'
    },
    {
        title: 'Submit Ticket',
        icon: '/images/icons/line-icon/notebook.png',
        link: 'mailto:constructionsightai@gmail.com?subject=Support Ticket',
        description: 'Describe your issue and we will get back to you.'
    }
];

const openTopic = (title) => {
    window.dispatchEvent(new CustomEvent('cs:help-topic-open', { detail: { title } }))
}

const HelpKnowledgebase = () => {
    const [searchResults, setSearchResults] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchCategory, setSearchCategory] = useState('all')
    const resultsRef = useRef(null)

    useEffect(() => {
        const handler = (e) => {
            const { query, category } = e.detail
            setSearchQuery(query)
            setSearchCategory(category || 'all')
            if (!query) {
                setSearchResults(null)
                return
            }
            const lower = query.toLowerCase()
            const results = Object.entries(helpTopicsContent)
                .filter(([title, content]) => {
                    const matchesCategory = !category || category === 'all' || content.category === category
                    const matchesQuery = title.toLowerCase().includes(lower) ||
                        content.intro?.toLowerCase().includes(lower) ||
                        content.steps?.some(s => s.toLowerCase().includes(lower)) ||
                        content.points?.some(p => p.toLowerCase().includes(lower))
                    return matchesCategory && matchesQuery
                })
                .map(([title]) => ({ title }))
            setSearchResults(results)
            setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        }
        window.addEventListener('cs:help-search', handler)
        return () => window.removeEventListener('cs:help-search', handler)
    }, [])

    const handleClearSearch = () => {
        setSearchResults(null)
        setSearchQuery('')
        setSearchCategory('all')
        window.dispatchEvent(new Event('cs:help-search-clear'))
    }

    return (
        <>
            <HelpBanner />
            <div className="main-content container-lg px-4 help-center-main-contet-area overflow-visible">
                {searchResults !== null && (
                    <section className="help-search-results-section" ref={resultsRef}>
                        {searchResults.length === 0 ? (
                            <>
                                <hr className="my-4 opacity-25" />
                                <div className="text-center py-5">
                                    <FiAlertCircle size={40} className="text-muted mb-3 opacity-50" />
                                    <h5 className="fw-semibold">No articles match "{searchQuery}"</h5>
                                    {searchCategory && searchCategory !== 'all' ? (
                                        <div className="mt-3">
                                            <span className="badge bg-soft-warning text-warning text-uppercase">{searchCategory}</span>
                                        </div>
                                    ) : null}
                                </div>
                                <hr className="my-4 opacity-25" />
                            </>
                        ) : (
                            <div className="row">
                                <div className="col-lg-6">
                                    {searchResults.filter((_, i) => i % 2 === 0).map(({ title }, i) => (
                                        <TrandingCard key={i} title={title} onTopicClick={openTopic} />
                                    ))}
                                </div>
                                <div className="col-lg-6">
                                    {searchResults.filter((_, i) => i % 2 === 1).map(({ title }, i) => (
                                        <TrandingCard key={i} title={title} onTopicClick={openTopic} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                )}
                <div className={`row help-quick-card${searchResults !== null ? ' help-quick-card-no-overlap' : ''}`}>
                    <HelpCard
                        description={"Browse step-by-step guides covering projects, cameras, invitations, and site management — everything you need to run ConstructionSight AI effectively."}
                        img={"/images/icons/line-icon/idea.png"}
                        title={"Knowledge Base"}
                    />
                    <HelpCard
                        description={"Reach our support team directly via phone or email. We are available to help you resolve issues, answer questions, and guide you through the platform."}
                        img={"/images/icons/line-icon/support.png"}
                        title={"Contact Support"}
                    />
                    <HelpCard
                        description={"Watch video walkthroughs of key features including project setup, camera configuration, live monitoring, and team management to get up to speed fast."}
                        img={"/images/icons/line-icon/rocket.png"}
                        title={"Video Tutorials"}
                    />
                </div>
                <section className="topic-category-section">
                    <div className="d-flex flex-column align-items-center justify-content-center mb-5">
                        <h2 className="fs-20 fw-bold mb-3">Documentation Category</h2>
                        <p className="px-5 mx-5 text-center text-muted text-truncate-3-line">Browse topics by area — from camera setup and project lifecycle to team management and live site monitoring. Find exactly what you need, fast.</p>
                    </div>
                    <div className="row">
                        {categoryData.map((card, index) => (
                            <div className="col-xl-4 col-lg-6" key={index}>
                                <CategoryCard {...card} onTopicClick={openTopic} />
                            </div>
                        ))}
                    </div>
                </section>
                <section className="topic-tranding-section">
                    <div className="d-flex flex-column align-items-center justify-content-center mb-5">
                        <h2 className="fs-20 fw-bold mb-3">Trending Topics</h2>
                        <p className="px-5 mx-5 text-center text-muted text-truncate-3-line">Most common questions from admins and project managers using ConstructionSight AI. Click any topic to read the full guide.</p>
                    </div>
                    <div className="row">
                        <div className="col-lg-6">
                            {trandingData.map((card, index) => (
                                <TrandingCard key={index} {...card} onTopicClick={openTopic} />
                            ))}
                        </div>
                        <div className="col-lg-6">
                            {trandingData.map((card, index) => (
                                <TrandingCard key={index} {...card} onTopicClick={openTopic} />
                            ))}
                        </div>
                    </div>
                </section>
                <section className="still-question-section">
                    <div className="d-flex flex-column align-items-center justify-content-center mb-5">
                        <h2 className="fs-20 fw-bold mb-3">Still Have A Question?</h2>
                        <p className="px-5 mx-5 text-center text-muted text-truncate-3-line">Can't find what you're looking for? Reach out to our team directly and we'll get back to you as soon as possible.</p>
                    </div>
                    <div className="row">
                        {questionData.map((card, index) => (
                            <QuestionCard key={index} {...card} />
                        ))}
                    </div>
                </section>
            </div>

        </>
    )
}

export default HelpKnowledgebase


const HelpCard = ({ img, title, description }) => {
    return (
        <div className="col-lg-4">
            <div className="card mb-4 mb-lg-0">
                <div className="card-body p-5">
                    <div className="wd-50 ht-50 d-flex align-items-center justify-content-center mb-5">
                        <img src={img} className="img-fluid" alt="img" />
                    </div>
                    <h2 className="fs-16 fw-bold mb-3">{title}</h2>
                    <p className="fs-12 fw-medium text-muted text-truncate-3-line">{description}</p>
                    <a href="#" className="fs-12">Learn More →</a>
                </div>
            </div>
        </div>
    )
}

const CategoryCard = ({ title, icon, topics, moreTopicsLink, totalTopic, onTopicClick }) => {
    return (
        <div className="card p-4 mb-4">
            <div className="d-sm-flex align-items-center">
                <div className="wd-50 ht-50 p-2 d-flex align-items-center justify-content-center border rounded-3">
                    <img src={icon} className="img-fluid" alt="img" />
                </div>
                <div className="ms-0 ms-sm-3 mt-4 mt-sm-0">
                    <h2 className="fs-14 fw-bold mb-1">{title}</h2>
                    <span className="fs-10 fw-semibold text-uppercase text-muted">{totalTopic} topics category</span>
                </div>
            </div>
            <ul className="list-unstyled mb-0 mt-4 ms-sm-5 ps-sm-3">
                {topics.map((topic, index) => (
                    <li key={index} className='mb-2'>
                        <i className="feather-file-text me-2 fs-13" ><FiFileText /></i>
                        <a
                            href="#"
                            className="fs-13 fw-medium"
                            data-bs-toggle="offcanvas"
                            data-bs-target="#topicsDetailsOffcanvas"
                            onClick={() => onTopicClick && onTopicClick(topic)}
                        >{topic}</a>
                    </li>
                ))}
            </ul>
            <div className="mt-4 ms-5 ps-3">
                <a href="#" className="fs-12">{moreTopicsLink}</a>
            </div>
        </div>
    );
}


export const TrandingCard = ({ title, onTopicClick }) => {
    const handleClick = () => {
        if (onTopicClick) onTopicClick(title)
    }
    return (
        <div className="card border rounded-3 mb-3 overflow-hidden">
            <div className="d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center">
                    <div className="wd-50 ht-50 bg-gray-100 me-3 d-flex align-items-center justify-content-center">
                        <FiFileText size={16} />
                    </div>
                    <a
                        href="#"
                        className="text-truncate-1-line"
                        data-bs-toggle="offcanvas"
                        data-bs-target="#topicsDetailsOffcanvas"
                        onClick={handleClick}
                    >{title}</a>
                </div>
                <a
                    href="#"
                    className="avatar-text avatar-sm me-3"
                    data-bs-toggle="offcanvas"
                    data-bs-target="#topicsDetailsOffcanvas"
                    onClick={handleClick}
                >
                    <FiArrowRight />
                </a>
            </div>
        </div>
    );
}

function QuestionCard({ title, icon, link, description }) {
    return (
        <div className="col-lg-4">
            <div className="card card-body pb-0 pb-lg-4 text-center">
                <a href={link} className="card stretch stretch-full p-5 mb-4 mb-lg-0 d-flex flex-column flex-fill align-items-center justify-content-center border rounded-3">
                    <div className="mb-4 wd-50 ht-50">
                        <img src={icon} className="img-fluid" alt={title} />
                    </div>
                    <div className="fs-14 fw-bold d-block mb-1">{title}</div>
                    {description && <div className="fs-12 fw-medium text-muted text-truncate-1-line">{description}</div>}
                </a>
            </div>
        </div>
    );
}
