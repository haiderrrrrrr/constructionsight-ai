import React from 'react'
import { FiPlus } from 'react-icons/fi'
import { Link } from 'react-router-dom'

const languagesList = [
  {
    id: 5,
    flag: "/images/flags/1x1/us.svg",
    language_name: "English"
  },
  {
    id: 1,
    flag: "/images/flags/1x1/sa.svg",
    language_name: "Arabic"
  },
  {
    id: 6,
    flag: "/images/flags/1x1/fr.svg",
    language_name: "French"
  },
  {
    id: 7,
    flag: "/images/flags/1x1/de.svg",
    language_name: "German"
  },
  {
    id: 10,
    flag: "/images/flags/1x1/es.svg",
    language_name: "Spanish"
  },
  {
    id: 3,
    flag: "/images/flags/1x1/ch.svg",
    language_name: "Chinese"
  },
]

const LanguagesModal = () => {
  return (
    <div className="dropdown nxl-h-item nxl-header-language d-none d-sm-flex">
      <div className="nxl-head-link me-0 nxl-language-link" data-bs-toggle="dropdown" data-bs-auto-close="outside">
        <img src="/images/flags/4x3/us.svg" alt="" className="img-fluid wd-20" />
      </div>
      <div className="dropdown-menu dropdown-menu-end nxl-h-dropdown nxl-language-dropdown">
        <div className="dropdown-divider mt-0"></div>
        <div className="language-items-wrapper">
          <div className="select-language px-4 py-2 hstack justify-content-between gap-4">
            <div className="lh-lg">
              <h6 className="mb-0">Select Language</h6>
              <p className="fs-11 text-muted mb-0">6 languages available!</p>
            </div>
            <span className="avatar-text avatar-md" data-bs-toggle="tooltip" title="Add Language">
              <FiPlus />
            </span>
          </div>
          <div className="dropdown-divider"></div>
          <div className="row px-4 pt-3">
            {
              languagesList.map(({flag, id, language_name}) => {
                return (
                  <div key={id} className="col-sm-4 col-6 language_select">
                    <Link to={"#"} className="d-flex align-items-center gap-2">
                      <div className="avatar-image avatar-sm"><img src={flag} alt="" className="img-fluid" /></div>
                      <span>{language_name}</span>
                    </Link>
                  </div>
                )
              })
            }
          </div>
        </div>
      </div>
    </div>
  )
}

export default LanguagesModal