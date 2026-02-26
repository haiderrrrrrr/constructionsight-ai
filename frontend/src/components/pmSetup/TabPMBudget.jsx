import React from 'react';
import { FiAlertCircle } from 'react-icons/fi';

const TabPMBudget = ({ setFormData, formData, error, setError }) => {
  return (
    <section className="step-body mt-4 body current">
      <style>{`.pm-error svg{stroke:#ef4444!important;color:#ef4444!important;}`}</style>
      <form id="project-budgets">
        <fieldset>
          <div className="mb-5 text-center">
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '1.1px',
              textTransform: 'uppercase',
              padding: '5px 13px',
              borderRadius: '30px',
              background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)',
              color: 'var(--bs-primary)',
              border: '1px solid rgba(var(--bs-primary-rgb),0.35)',
              marginBottom: '14px',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)',
            }}>
              Budget
            </div>
            <h2 className="fw-bolder mb-2 text-center" style={{ fontSize: '22px', lineHeight: '1.2' }}>
              Project Budget
            </h2>
            <p className="fs-12 fw-medium text-muted mb-0 text-center" style={{ lineHeight: '1.6' }}>
              Select a budget range aligned with your project scope
            </p>
          </div>

          {error && (
            <div className="pm-error d-flex align-items-center gap-2 mb-4 px-3 py-2 rounded-2"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
              <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{error}</span>
            </div>
          )}

          <fieldset>
            <Card
              title={"Budget Tier 1"}
              budget={"Rs. 1,00,000 - Rs. 9,99,999"}
              id={"budgets_tier_1"}
              name={"project-budgets"}
              setFormData={setFormData}
              formData={formData}
              setError={setError}
            />
            <Card
              title={"Budget Tier 2"}
              budget={"Rs. 10,00,000 - Rs. 49,99,999"}
              id={"budgets_tier_2"}
              name={"project-budgets"}
              setFormData={setFormData}
              formData={formData}
              setError={setError}
            />
            <Card
              title={"Budget Tier 3"}
              budget={"Rs. 50,00,000 - Rs. 99,99,999"}
              id={"budgets_tier_3"}
              name={"project-budgets"}
              setFormData={setFormData}
              formData={formData}
              setError={setError}
            />
            <Card
              title={"Budget Tier 4"}
              budget={"Rs. 1,00,00,000+"}
              id={"budgets_tier_4"}
              name={"project-budgets"}
              setFormData={setFormData}
              formData={formData}
              setError={setError}
            />
          </fieldset>
        </fieldset>
      </form>
    </section>
  );
};

export default TabPMBudget;

const Card = ({ title, id, budget, name, setFormData, formData, setError }) => {
  const handleOnChange = (e) => {
    const name = e.target.name;
    const id = e.target.id;

    let updatedType = { ...formData };

    if (name === "project-budgets") {
      // Toggle: if already selected, deselect; else select
      updatedType = { ...updatedType, budget_tier: formData.budget_tier === id ? '' : id };
      setError('');
    }

    setFormData({ ...formData, ...updatedType });
  };

  const { budget_tier } = formData;
  return (
    <label className="w-100" htmlFor={id}>
      <input
        className="card-input-element"
        type="radio"
        name={name}
        id={id}
        onChange={(e) => handleOnChange(e)}
        checked={budget_tier === id ? true : false}
      />
      <span className="card card-body d-flex flex-row justify-content-between align-items-center">
        <span>
          <span className="d-block fs-13 fw-normal text-muted mb-2">{title}</span>
          <span className="d-block fw-bold text-dark mb-0" style={{ fontSize: '0.95rem', letterSpacing: '0.3px' }}>{budget}</span>
        </span>
      </span>
    </label>
  );
};
