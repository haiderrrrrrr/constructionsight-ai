import React from 'react'
import Lottie from 'lottie-react'
import RegisterForm from '@/components/authentication/RegisterForm'
import lottieAnimation from '../../assets/animations/city-skyline-3d.json'

const RegisterCover = () => {
    return (
        <main className="auth-cover-wrapper">
            <div className="auth-cover-content-inner">
                <div className="auth-cover-content-wrapper">
                    <div className="auth-img">
                        <Lottie animationData={lottieAnimation} loop={true} />
                    </div>
                </div>
            </div>
            <div className="auth-cover-sidebar-inner" style={{ overflowY: 'auto', height: '100vh' }}>
                <div className="auth-cover-card-wrapper">
                    <div className="auth-cover-card p-sm-5">
                        <div className="d-flex align-items-center gap-3 mb-5">
                            <div className="wd-50 flex-shrink-0">
                                <img src="/images/logo-abbr.png" alt="img" className="img-fluid" />
                            </div>
                            <img src="/images/logo-full.png" alt="ConstructionSight" className="auth-logo-full" style={{ height: '17px', width: 'auto' }} />
                        </div>
                        <RegisterForm path={"/login"} />
                    </div>
                </div>
            </div>
        </main>
    )
}

export default RegisterCover
