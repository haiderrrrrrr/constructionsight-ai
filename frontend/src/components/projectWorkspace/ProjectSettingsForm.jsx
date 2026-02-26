import React from 'react'
import InputTopLabel from '@/components/shared/InputTopLabel'
import TextAreaTopLabel from '@/components/shared/TextAreaTopLabel'

const ProjectSettingsForm = ({ title, description, sections }) => {
    return (
        <>
            <div className="mb-4">
                <h5 className="mb-2 fw-semibold">{title}</h5>
                <p className="text-muted fs-13 mb-0">{description}</p>
            </div>

            {sections.map((section, idx) => (
                <div key={idx} className="mb-5">
                    {section.title && <h6 className="mb-4 fw-semibold">{section.title}</h6>}

                    {section.fields && section.fields.map((field, fIdx) => (
                        <InputTopLabel
                            key={fIdx}
                            label={field.label}
                            placeholder={field.placeholder}
                            info={field.info}
                        />
                    ))}

                    {section.textareas && section.textareas.map((textarea, tIdx) => (
                        <TextAreaTopLabel
                            key={tIdx}
                            label={textarea.label}
                            placeholder={textarea.placeholder}
                            info={textarea.info}
                        />
                    ))}

                    {section.customContent && section.customContent}
                </div>
            ))}

            <div className="d-flex gap-2">
                <button className="btn btn-primary">Save Settings</button>
                <button className="btn btn-outline-secondary">Discard Changes</button>
            </div>
        </>
    )
}

export default ProjectSettingsForm
