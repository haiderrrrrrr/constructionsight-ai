import PerfectScrollbar from 'react-perfect-scrollbar'
import React, { useEffect, useState } from 'react'
import { FiSettings, FiX } from 'react-icons/fi'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { apiPatch, isTokenValid } from '@/utils/api'

const fontFalmily = [
    { isChecked: false, value: "app-font-family-lato", label: "Lato" },
    { isChecked: false, value: "app-font-family-rubik", label: "Rubik" },
    { isChecked: true, value: "app-font-family-inter", label: "Inter" },
    { isChecked: false, value: "app-font-family-cinzel", label: "Cinzel" },
    { isChecked: false, value: "app-font-family-nunito", label: "Nunito" },
    { isChecked: false, value: "app-font-family-roboto", label: "Roboto" },
    { isChecked: false, value: "app-font-family-ubuntu", label: "Ubuntu" },
    { isChecked: false, value: "app-font-family-poppins", label: "Poppins" },
    { isChecked: false, value: "app-font-family-raleway", label: "Raleway" },
    { isChecked: false, value: "app-font-family-system-ui", label: "System UI" },
    { isChecked: false, value: "app-font-family-noto-sans", label: "Noto Sans" },
    { isChecked: false, value: "app-font-family-fira-sans", label: "Fira Sans" },
    { isChecked: false, value: "app-font-family-work-sans", label: "Work Sans" },
    { isChecked: false, value: "app-font-family-open-sans", label: "Open Sans" },
    { isChecked: false, value: "app-font-family-maven-pro", label: "Maven Pro" },
    { isChecked: false, value: "app-font-family-quicksand", label: "Quicksand" },
    { isChecked: false, value: "app-font-family-montserrat", label: "Montserrat" },
    { isChecked: false, value: "app-font-family-josefin-sans", label: "Josefin Sans" },
    { isChecked: false, value: "app-font-family-ibm-plex-sans", label: "Ibm Plex Sans" },
    { isChecked: false, value: "app-font-family-source-sans-pro", label: "Source Sans Pro" },
    { isChecked: false, value: "app-font-family-montserrat-alt", label: "Montserrat Alt" },
    { isChecked: false, value: "app-font-family-roboto-slab", label: "Roboto Slab" },
]

const ThemeCustomizer = () => {
    const [open, setOpen] = useState(false)

    function saveThemeToServer(patch) {
        if (!isTokenValid()) return
        apiPatch('/users/me/theme', patch).catch(() => {})
    }

    const applySkinTheme = (type) => {
        const html = document.documentElement
        html.classList.add('theme-switching')
        if (type === "dark") {
            html.classList.add("app-skin-dark");
            html.classList.add("app-navigation-dark");
            html.classList.add("app-header-dark");
            localStorage.setItem("skinTheme", "dark");
            document.getElementById("app-skin-dark").checked = true;
            document.getElementById("app-skin-light").checked = false;
        } else {
            html.classList.remove("app-skin-dark");
            html.classList.remove("app-navigation-dark");
            html.classList.remove("app-header-dark");
            localStorage.setItem("skinTheme", "light");
            document.getElementById("app-skin-dark").checked = false;
            document.getElementById("app-skin-light").checked = true;
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                html.classList.remove('theme-switching')
            })
        })
    };

    const handleSkinTheme = (type) => {
        applySkinTheme(type);
        saveThemeToServer({ theme_skin: type });
        broadcastRefresh('cs:theme-skin-change');
    };

    const enforceMavenPro = () => {
        const existingFontClass = document.documentElement.classList.value.match(/app-font-family-\w+/);
        if (existingFontClass) {
            document.documentElement.classList.remove(existingFontClass[0]);
        }
        document.documentElement.classList.add("app-font-family-maven-pro");
        localStorage.setItem("fontFamily", "app-font-family-maven-pro");
    };

    const handleResetAll = () => {
        const classes = Array.from(document.documentElement.classList);
        const withoutFont = classes.filter(c => !/^app-font-family-\w+/.test(c));
        document.documentElement.classList.remove(...classes);
        withoutFont.forEach(c => document.documentElement.classList.add(c));
        enforceMavenPro();
        handleSkinTheme("light");
        setOpen(false);
    };

    // Load saved theme from localStorage on page load (default to dark)
    const loadSavedTheme = () => {
        const savedSkinTheme = localStorage.getItem("skinTheme") || "dark";
        applySkinTheme(savedSkinTheme);
        enforceMavenPro();
    };

    useEffect(() => {
        loadSavedTheme();
    }, []);

    // Listen for theme changes (same tab and other tabs)
    useEffect(() => {
        const handler = () => {
            const savedTheme = localStorage.getItem("skinTheme");
            if (savedTheme) applySkinTheme(savedTheme);
        }
        window.addEventListener('cs:theme-skin-change', handler)
        const unsubSkin = onBroadcast('cs:theme-skin-change', handler);

        return () => {
            window.removeEventListener('cs:theme-skin-change', handler)
            unsubSkin();
        };
    }, []);

    return (
        <div className={`theme-customizer ${open ? "theme-customizer-open" : ""}`}>
            <div className="customizer-handle">
                <a href="#" className="cutomizer-open-trigger bg-primary" onClick={(e) => { e.preventDefault(), setOpen(true) }}>
                    <i className='lh-1'><FiSettings size={16} /></i>
                </a>
            </div>
            <div className="customizer-sidebar-wrapper">
                <div className="customizer-sidebar-header px-4 ht-80 border-bottom d-flex align-items-center justify-content-between">
                    <h5 className="mb-0">Theme Settings</h5>
                    <a href="#" className="cutomizer-close-trigger d-flex" onClick={(e) => {e.preventDefault(), setOpen(false)}}>
                        <FiX size={16} />
                    </a>
                </div>
                <div className="customizer-sidebar-body position-relative p-4">
                    <PerfectScrollbar>
                        {/*! BEGIN: [Skins] !*/}
                        <div className="position-relative px-3 pb-3 pt-4 mt-3 mb-5 border border-gray-2 theme-options-set">
                            <label className="py-1 px-2 fs-8 fw-bold text-uppercase text-muted text-spacing-2 bg-white border border-gray-2 position-absolute rounded-2 options-label" style={{ top: '-12px' }}>Theme</label>
                            <div className="row g-2 theme-options-items app-skin" id="appSkinList">
                                <div className="col-6 text-center position-relative single-option light-button" onClick={() => handleSkinTheme("light")}>
                                    <input type="radio" className="btn-check" id="app-skin-light" name="app-skin" defaultValue={1} data-app-skin="app-skin-light" defaultChecked />
                                    <label className="py-2 fs-9 fw-bold text-dark text-uppercase text-spacing-1 border border-gray-2 w-100 h-100 c-pointer position-relative options-label" htmlFor="app-skin-light">Light</label>
                                </div>
                                <div className="col-6 text-center position-relative single-option dark-button" onClick={() => handleSkinTheme("dark")}>
                                    <input type="radio" className="btn-check" id="app-skin-dark" name="app-skin" defaultValue={2} data-app-skin="app-skin-dark" />
                                    <label className="py-2 fs-9 fw-bold text-dark text-uppercase text-spacing-1 border border-gray-2 w-100 h-100 c-pointer position-relative options-label" htmlFor="app-skin-dark">Dark</label>
                                </div>
                            </div>
                        </div>
                        {/*! END: [Skins] !*/}
                    </PerfectScrollbar>
                </div>
            </div>
        </div>

    )
}

export default ThemeCustomizer
