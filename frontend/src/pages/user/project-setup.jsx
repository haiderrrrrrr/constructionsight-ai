import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet } from '../../utils/api';
import PMSetupWizard from '../../components/pmSetup/PMSetupWizard';

const ProjectSetup = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const [prefillData, setPrefillData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                if (data.my_role !== 'project_manager') {
                    navigate(`/projects/${projectId}/dashboard`, { replace: true });
                    return;
                }
                if (data.status === 'active' || data.status === 'completed' || data.status === 'archived') {
                    navigate(`/projects/${projectId}/dashboard`, { replace: true });
                    return;
                }
                setPrefillData(data);
            })
            .catch(() => {
                setError('Project not found or access denied.');
            })
            .finally(() => setLoading(false));
    }, [projectId]);

    if (loading) return <PageLoader minHeight="60vh" />

    if (error) {
        return (
            <div className="nxl-content-inner">
                <div className="alert alert-danger">{error}</div>
            </div>
        );
    }

    return (
        <>
            <PageHeader>
                <div className="d-flex align-items-center gap-2">
                    <style>{`
                        .cs-create-header-btn:focus,
                        .cs-create-header-btn:focus-visible,
                        .cs-create-header-btn:active {
                            box-shadow: none !important;
                            outline: none !important;
                        }
                    `}</style>
                    <button
                        type="button"
                        className="btn btn-danger d-inline-flex align-items-center cs-create-header-btn"
                        style={{ fontWeight: 600, transition: 'none' }}
                        onClick={() => {
                            try { sessionStorage.removeItem(`cs:draft:pm-setup:${projectId}`) } catch {}
                            navigate('/projects/my')
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <PMSetupWizard
                        prefillData={prefillData}
                        projectId={parseInt(projectId, 10)}
                        onActivated={() => navigate(`/projects/${projectId}/info`, { replace: true })}
                    />
                </div>
            </div>
        </>
    );
};

export default ProjectSetup;
