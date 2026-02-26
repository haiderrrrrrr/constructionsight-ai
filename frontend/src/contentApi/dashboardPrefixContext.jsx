import React, { createContext, useContext } from 'react'

export const DashboardPrefixContext = createContext("")

export const DashboardPrefixProvider = ({ prefix, children }) => (
    <DashboardPrefixContext.Provider value={prefix}>
        {children}
    </DashboardPrefixContext.Provider>
)

export const useDashboardPrefix = () => useContext(DashboardPrefixContext)
