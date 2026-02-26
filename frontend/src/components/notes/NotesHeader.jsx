import { BsArrowLeft, BsArrowRight } from 'react-icons/bs'

const NotesHeader = ({ onPrev, onNext, prevDisabled, nextDisabled }) => {
    return (
        <div className="content-area-header sticky-top">
            <div className="page-header-left" />
            <div className="page-header-right ms-auto">
                <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style">
                    <li style={prevDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault()
                                onPrev?.()
                            }}
                            title="Previous"
                        >
                            <BsArrowLeft size={16} />
                        </a>
                    </li>
                    <li style={nextDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault()
                                onNext?.()
                            }}
                            title="Next"
                        >
                            <BsArrowRight size={16} />
                        </a>
                    </li>
                </ul>
            </div>
        </div>
    )
}
export default NotesHeader
