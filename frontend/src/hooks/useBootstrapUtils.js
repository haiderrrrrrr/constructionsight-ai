import React, { useEffect } from 'react'
import { Tooltip, Toast, Popover } from 'bootstrap';

const useBootstrapUtils = (pathName) => {
    useEffect(() => {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
        const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new Tooltip(tooltipTriggerEl))

        const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
        const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new Popover(popoverTriggerEl))
        return () => {
            tooltipList.forEach(t => t?.dispose?.())
            popoverList.forEach(p => p?.dispose?.())
        };

    }, [pathName])
}

export default useBootstrapUtils
