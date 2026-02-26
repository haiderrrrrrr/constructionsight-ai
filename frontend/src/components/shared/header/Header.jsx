import React, { useContext, useEffect, useRef, useState, cloneElement } from 'react'
import { FiAlignLeft, FiArrowLeft, FiArrowRight, FiChevronRight, FiMaximize, FiMinimize, FiMoon, FiSun, FiAlertTriangle } from "react-icons/fi";
import LanguagesModal from './LanguagesModal';
import NotificationsModal from './NotificationsModal';
import ProfileModal from './ProfileModal';
import { NavigationContext } from '../../../contentApi/navigationProvider';
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { apiPatch, getCurrentUserId } from '@/utils/api'
import { useParams, useLocation } from 'react-router-dom'

const ALERT_STORAGE_KEYS = (id) => {
    const uid = getCurrentUserId()
    return [
        `ppe-alerts-${uid}-${id}`,
        `wf-alerts-${uid}-${id}`,
        `act-alerts-${uid}-${id}`,
    ]
}
const ALERT_EVENTS = ['ppe:alerts-updated', 'wf:alerts-updated', 'act:alerts-updated', 'cs:alerts-clear-all']

const Header = () => {
    const { navigationOpen, setNavigationOpen } = useContext(NavigationContext)
    const { projectId } = useParams()
    const location = useLocation()
    const isProjectWorkspace = location.pathname.startsWith('/projects/') && !location.pathname.startsWith('/admin/')
    const [navigationExpend, setNavigationExpend] = useState(false)
    const miniButtonRef = useRef(null);
    const expendButtonRef = useRef(null);
    const [skinTheme, setSkinTheme] = useState(() => {
        const v = localStorage.getItem('skinTheme')
        return v === 'dark' || v === 'light' ? v : 'dark'
    })
    const [alertCount, setAlertCount] = useState(0)

    // Count alerts across all 3 features
    useEffect(() => {
        if (!projectId || !isProjectWorkspace) { setAlertCount(0); return }

        const updateAlertCount = () => {
            try {
                const total = ALERT_STORAGE_KEYS(projectId).reduce((acc, key) => {
                    const stored = localStorage.getItem(key)
                    return acc + (stored ? JSON.parse(stored).length : 0)
                }, 0)
                setAlertCount(total)
            } catch { setAlertCount(0) }
        }

        updateAlertCount()
        ALERT_EVENTS.forEach(e => window.addEventListener(e, updateAlertCount))
        window.addEventListener('storage', updateAlertCount)
        return () => {
            ALERT_EVENTS.forEach(e => window.removeEventListener(e, updateAlertCount))
            window.removeEventListener('storage', updateAlertCount)
        }
    }, [projectId, isProjectWorkspace])

    const handleThemeMode = (type, persist = true) => {
        const root = document.documentElement

        if (type === "dark") {
            root.classList.add("app-skin-dark")
            root.classList.add("app-navigation-dark")
            root.classList.add("app-header-dark")
            localStorage.setItem("skinTheme", "dark");
        }
        else {
            root.classList.remove("app-skin-dark")
            root.classList.remove("app-navigation-dark")
            root.classList.remove("app-header-dark")
            localStorage.setItem("skinTheme", "light");
        }

        if (persist) {
            apiPatch('/users/me/theme', { theme_skin: type }).catch(() => {})
            broadcastRefresh('cs:theme-skin-change')
        }
        setSkinTheme(type === 'dark' ? 'dark' : 'light')
    }

    useEffect(() => {
        const handleResize = () => {
            const newWindowWidth = window.innerWidth;
            if (newWindowWidth <= 1024) {
                document.documentElement.classList.remove('minimenu');
                document.querySelector('.navigation-down-1600').style.display = 'none';
            }
            else if (newWindowWidth >= 1025 && newWindowWidth <= 1400) {
                document.documentElement.classList.add('minimenu');
                document.querySelector('.navigation-up-1600').style.display = 'none';
                document.querySelector('.navigation-down-1600').style.display = 'block';
            }
            else {
                document.documentElement.classList.remove('minimenu');
                document.querySelector('.navigation-up-1600').style.display = 'block';
                document.querySelector('.navigation-down-1600').style.display = 'none';
            }
        };

        window.addEventListener('resize', handleResize);

        handleResize();

        const savedSkinTheme = localStorage.getItem("skinTheme");
        if (savedSkinTheme === 'dark' || savedSkinTheme === 'light') {
            handleThemeMode(savedSkinTheme, false)
        }

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    useEffect(() => {
        const handler = () => {
            const t = localStorage.getItem('skinTheme')
            if (t === 'dark' || t === 'light') handleThemeMode(t, false)
        }
        window.addEventListener('cs:theme-skin-change', handler)
        const unsub = onBroadcast('cs:theme-skin-change', handler)
        return () => {
            window.removeEventListener('cs:theme-skin-change', handler)
            unsub()
        }
    }, [])

    const handleNavigationExpendUp = (e, pram) => {
        e.preventDefault()
        if (pram === "show") {
            setNavigationExpend(true);
            document.documentElement.classList.add('minimenu')
        }
        else {
            setNavigationExpend(false);
            document.documentElement.classList.remove('minimenu')
        }
    }

    const handleNavigationExpendDown = (e, pram) => {
        e.preventDefault()
        if (pram === "show") {
            setNavigationExpend(true);
            document.documentElement.classList.remove('minimenu')
        }
        else {
            setNavigationExpend(false);
            document.documentElement.classList.add('minimenu')
        }
    }

    const fullScreenMaximize = () => {
        const elem = document.documentElement;

        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }

        document.documentElement.classList.add("fsh-infullscreen")
        document.querySelector("body").classList.add("full-screen-helper")

    };
    const fullScreenMinimize = () => {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) { 
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }

        document.documentElement.classList.remove("fsh-infullscreen")
        document.querySelector("body").classList.remove("full-screen-helper")
    }

    return (
        <header className="nxl-header">
            <div className="header-wrapper">

                {/* <!--! [Start] Header Left !--> */}
                <div className="header-left d-flex align-items-center gap-4">
                    {/* <!--! [Start] nxl-head-mobile-toggler !--> */}
                    <a href="#" className="nxl-head-mobile-toggler d-lg-none" onClick={(e) => {e.preventDefault(), setNavigationOpen(true)}} id="mobile-collapse">
                        <div className={`hamburger hamburger--arrowturn ${navigationOpen ? "is-active" : ""}`}>
                            <div className="hamburger-box">
                                <div className="hamburger-inner"></div>
                            </div>
                        </div>
                    </a>
                    {/* <!--! [Start] nxl-head-mobile-toggler !-->
                    <!--! [Start] nxl-navigation-toggle !--> */}
                    <div className="nxl-navigation-toggle navigation-up-1600 d-none d-lg-flex">
                        <a href="#" onClick={(e) => handleNavigationExpendUp(e, "show")} id="menu-mini-button" ref={miniButtonRef} style={{ display: navigationExpend ? "none" : "block" }}>
                            <FiAlignLeft size={24} />
                        </a>
                        <a href="#" onClick={(e) => handleNavigationExpendUp(e, "hide")} id="menu-expend-button" ref={expendButtonRef} style={{ display: navigationExpend ? "block" : "none" }}>
                            <FiArrowRight size={24} />
                        </a>
                    </div>
                    <div className="nxl-navigation-toggle navigation-down-1600">
                        <a href="#" onClick={(e) => handleNavigationExpendDown(e, "hide")} id="menu-mini-button" ref={miniButtonRef} style={{ display: navigationExpend ? "block" : "none" }}>
                            <FiAlignLeft size={24} />
                        </a>
                        <a href="#" onClick={(e) => handleNavigationExpendDown(e, "show")} id="menu-expend-button" ref={expendButtonRef} style={{ display: navigationExpend ? "none" : "block" }}>
                            <FiArrowRight size={24} />
                        </a>
                    </div>
                    {/* <!--! [End] nxl-navigation-toggle !--> */}
                </div>
                {/* <!--! [End] Header Left !-->
                <!--! [Start] Header Right !--> */}
                <div className="header-right ms-auto">
                    <div className="d-flex align-items-center">
                        <LanguagesModal />
                        <div className="nxl-h-item d-none d-sm-flex" >
                            <div className="full-screen-switcher">
                                <span className="nxl-head-link me-0">
                                    <FiMaximize size={20} className="maximize" onClick={fullScreenMaximize} />
                                    <FiMinimize size={20} className="minimize" onClick={fullScreenMinimize} />
                                </span>
                            </div>
                        </div>
                        <div className="nxl-h-item dark-light-theme">
                            {skinTheme === 'dark' ? (
                                <div className="nxl-head-link me-0 light-button" onClick={() => handleThemeMode("light")}>
                                    <FiSun size={20} />
                                </div>
                            ) : (
                                <div className="nxl-head-link me-0 dark-button" onClick={() => handleThemeMode("dark")}>
                                    <FiMoon size={20} />
                                </div>
                            )}
                        </div>
                        {projectId && isProjectWorkspace && (
                            <div className="nxl-h-item">
                                <div
                                    className="nxl-head-link"
                                    onClick={(e) => {
                                        if (alertCount === 0) return
                                        e.preventDefault()
                                        window.dispatchEvent(new CustomEvent('cs:open-alerts-drawer'))
                                    }}
                                    title={alertCount > 0 ? `${alertCount} live alert${alertCount !== 1 ? 's' : ''}` : 'No live alerts'}
                                    style={{
                                        cursor: alertCount > 0 ? 'pointer' : 'default',
                                        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        opacity: alertCount > 0 ? 1 : 0.45,
                                    }}
                                >
                                    {cloneElement(<FiAlertTriangle size={20} />, {
                                        color: alertCount > 0 ? '#dc3545' : 'currentColor',
                                        stroke: alertCount > 0 ? '#dc3545' : 'currentColor',
                                    })}
                                    {alertCount > 0 && (
                                        <span className="badge bg-danger nxl-h-badge">
                                            {alertCount > 9 ? '9+' : alertCount}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        <NotificationsModal />
                        <ProfileModal />
                    </div>
                </div>
                {/* <!--! [End] Header Right !--> */}
            </div>
        </header>
    )
}

export default Header
