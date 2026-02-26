import React from 'react'
import { OrbitProgress } from 'react-loading-indicators'

const isRouteLikeHeight = (minHeight) => {
    if (typeof minHeight === 'string') {
        return /(?:^|[^\d])(?:5[0-9]|[6-9][0-9]|100)vh\b/i.test(minHeight.trim())
    }
    return false
}

const PageLoader = ({ minHeight = 300, mode = 'auto', overlay = null }) => {
    const resolvedMode = mode === 'auto'
        ? (overlay === true || isRouteLikeHeight(minHeight) ? 'route' : 'block')
        : mode

    if (resolvedMode === 'route') {
        return (
            <div className="cs-route-loader" role="status" aria-live="polite">
                <style>{`
                    .cs-route-loader {
                        position: fixed;
                        top: var(--cs-header-height, 70px);
                        left: var(--cs-sidebar-width, 280px);
                        right: 0;
                        bottom: 0;
                        z-index: 900;
                        display: grid;
                        place-items: center;
                        background: var(--bs-body-bg);
                    }
                    body.minimenu .cs-route-loader,
                    body.nxl-navigation-collapsed .cs-route-loader {
                        left: var(--cs-sidebar-collapsed-width, 80px);
                    }
                    @media (max-width: 991.98px) {
                        .cs-route-loader {
                            left: 0;
                            top: var(--cs-header-height, 70px);
                        }
                    }
                `}</style>
                <OrbitProgress color="#3454d1" size="small" text="" textColor="" />
            </div>
        )
    }

    return (
        <div
            className="cs-block-loader"
            role="status"
            aria-live="polite"
            style={{
                minHeight,
                width: '100%',
                display: 'grid',
                placeItems: 'center',
                alignSelf: 'stretch',
            }}
        >
            <OrbitProgress color="#3454d1" size="small" text="" textColor="" />
        </div>
    )
}

export default PageLoader
