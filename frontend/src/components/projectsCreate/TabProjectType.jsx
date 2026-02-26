import React from 'react'
import getIcon from '@/utils/getIcon'
import { FiAlertTriangle, FiCheck } from 'react-icons/fi'

const TabProjectType = ({ setFormData, formData, error, setError }) => {

    return (

        <section className="step-body mt-4 body current">
            <form id="project-type">
                <fieldset>
                    <div className="mb-5 text-center">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color: 'var(--bs-primary,#5b6abf)', border: '1px solid rgba(91,106,191,0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Configuration</div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Project Setup</h2>
                        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Define how this project is structured and used</p>
                        {error && <label id="project-type-error" className="error mt-2"><FiAlertTriangle /> This field is required.</label>}
                    </div>
                    <fieldset>
                        <ProjectTypeCard
                            icon={"feather-user"}
                            title={"Personal workspace"}
                            description={"For individual use without team collaboration"}
                            id={"project_personal"}
                            name={"project-type"}
                            isRequired={true}
                            setFormData={setFormData}
                            formData={formData}
                            setError={setError}
                        />
                        <ProjectTypeCard
                            icon={"feather-users"}
                            title={"Team workspace"}
                            description={"For collaborative work with shared access and role-based permissions"}
                            id={"project_team"}
                            name={"project-type"}
                            isRequired={false}
                            setFormData={setFormData}
                            formData={formData}
                            setError={setError}
                        />
                    </fieldset>
                </fieldset>
                <hr className="mb-5" />
                <fieldset>
                    <div className="mb-5 text-center">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color: 'var(--bs-primary,#5b6abf)', border: '1px solid rgba(91,106,191,0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Access</div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Access Control</h2>
                        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Define who can manage this project</p>
                        {error && <label id="project-type-error" className="error mt-2"><FiAlertTriangle /> This field is required.</label>}
                    </div>
                    <fieldset>
                        <ProjectTypeCard
                            icon={"feather-globe"}
                            title={"All Members"}
                            description={"All internal users can manage this project. Guest access is restricted"}
                            id={"project_everyone"}
                            name={"project-manage"}
                            isRequired={true}
                            setFormData={setFormData}
                            formData={formData}
                            setError={setError}
                        />
                        <ProjectTypeCard
                            icon={"feather-shield"}
                            title={"Administrators"}
                            description={"Only administrators can manage settings, members, and access"}
                            id={"project_admin"}
                            name={"project-manage"}
                            isRequired={false}
                            setFormData={setFormData}
                            formData={formData}
                            setError={setError}
                        />
                        <ProjectTypeCard
                            icon={"feather-settings"}
                            title={"Selected Users"}
                            description={"Access and management are limited to selected users"}
                            id={"project_specific"}
                            name={"project-manage"}
                            isRequired={false}
                            setFormData={setFormData}
                            formData={formData}
                            setError={setError}
                        />
                    </fieldset>
                </fieldset>
            </form>
        </section>

    )
}

export default TabProjectType

export const ProjectTypeCard = ({ icon, title, description, id, isRequired, name, setFormData, formData, setError }) => {
    const handleOnClick = (e) => {
        const name = e.target.name
        const id = e.target.id
        let updatedType = { ...formData };
        
        if (name === "project-type") {
            updatedType = { ...updatedType, projectType: formData.projectType === id ? null : id };
            if (updatedType.projectType) setError(false)
        }
        if (name === "project-manage") {
            updatedType = { ...updatedType, projectManage: formData.projectManage === id ? null : id };
            if (updatedType.projectManage) setError(false)
        }
        if (name === "budget-spend") {
            updatedType = { ...updatedType, budgetsSpend: formData.budgetsSpend === id ? null : id };
            if (updatedType.budgetsSpend) setError(false)
        }
        setFormData({ ...formData, ...updatedType });
    }

    const { projectType, projectManage, budgetsSpend } = formData
    const isChecked = projectType === id || projectManage === id || budgetsSpend === id
    return (
        <>

            <label className="w-100" htmlFor={id}>
                <input
                    className="card-input-element"
                    type="radio"
                    name={name}
                    id={id}
                    required={isRequired}
                    checked={isChecked}
                    onChange={() => {}}
                    onClick={(e) => handleOnClick(e)}
                />
                <span className="card card-body d-flex flex-row justify-content-between align-items-center ">
                    <span className="hstack gap-3">
                        <span className="avatar-text">
                            {React.cloneElement(getIcon(icon), { size: "16", strokeWidth: "1.6" })}
                        </span>
                        <span>
                            <span className="d-block fs-13 fw-bold text-dark">{title}</span>
                            <span className="d-block text-muted mb-0" dangerouslySetInnerHTML={{ __html: description }} />
                        </span>
                    </span>
                </span>
            </label>
        </>
    )
}
