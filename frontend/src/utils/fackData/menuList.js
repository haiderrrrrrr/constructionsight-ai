export const menuList = [
    {
        id: 0,
        name: "dashboards",
        label: "Dashboard",
        path: "#",
        icon: 'feather-airplay',
        dropdownMenu: [
            {
                id: 2,
                name: "Analytics",
                path: "/dashboards/analytics",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 1,
        name: "reports",
        path: "#",
        icon: 'feather-cast',
        dropdownMenu: [
            {
                id: 1,
                name: "Project Report",
                path: "/reports/project",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Safety Reports",
                path: "/reports/safety",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Workforce Analytics",
                path: "/reports/workforce",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Equipment Usage",
                path: "/reports/equipment",
                subdropdownMenu: false
            },
        ]
    },
    {
        id: 2,
        name: "applications",
        path: '#',
        icon: 'feather-send',
        dropdownMenu: [
            {
                id: 1,
                name: "Chat",
                path: "/applications/chat",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Email",
                path: "/applications/email",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Tasks",
                path: "/applications/tasks",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Notes",
                path: "/applications/notes",
                subdropdownMenu: false
            },
            {
                id: 5,
                name: "Storage",
                path: "/applications/storage",
                subdropdownMenu: false
            },
            {
                id: 6,
                name: "Calender",
                path: "/applications/calender",
                subdropdownMenu: false
            },
        ]
    },
    {
        id: 3,
        name: "proposal",
        path: "#",
        icon: 'feather-file-text',
        dropdownMenu: [
            {
                id: 1,
                name: "Proposal",
                path: "/proposal/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Proposal View",
                path: "/proposal/view",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Proposal Edit",
                path: "/proposal/edit",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Proposal Create",
                path: "/proposal/create",
                subdropdownMenu: false
            },

        ],
    },
    {
        id: 4,
        name: "payment",
        path: "#",
        icon: 'feather-dollar-sign',
        dropdownMenu: [
            {
                id: 1,
                name: "Payment",
                path: "/payment/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Invoice View",
                path: "/payment/view",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Invoice Create",
                path: "/payment/create",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 5,
        name: "customers",
        path: "#",
        icon: 'feather-users',
        dropdownMenu: [
            {
                id: 1,
                name: "Customers",
                path: "/customers/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Customers View",
                path: "/customers/view",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Customers Create",
                path: "/customers/create",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 6,
        name: "leads",
        path: "#",
        icon: 'feather-alert-circle',
        dropdownMenu: [
            {
                id: 1,
                name: "Leads",
                path: "/leads/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Leads View",
                path: "/leads/view",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Leads Create",
                path: "/leads/create",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 7,
        name: "projects",
        path: "#",
        icon: 'feather-briefcase',
        dropdownMenu: [
            {
                id: 1,
                name: "Project List",
                path: "/projects/my",
                subdropdownMenu: false
            },
        ]
    },
    {
        id: 8,
        name: "widgets",
        path: "#",
        icon: 'feather-layout',
        dropdownMenu: [
            {
                id: 1,
                name: "Lists",
                path: "/widgets/lists",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Tables",
                path: "/widgets/tables",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Charts",
                path: "/widgets/charts",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Statistics",
                path: "/widgets/statistics",
                subdropdownMenu: false
            },
            {
                id: 5,
                name: "Miscellaneous",
                path: "/widgets/miscellaneous",
                subdropdownMenu: false
            },
        ]
    },
    {
        id: 9,
        name: "settings",
        path: "#",
        icon: 'feather-settings',
        dropdownMenu: [
            {
                id: 1,
                name: "General",
                path: "/settings/general",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "SEO",
                path: "/settings/seo",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Tags",
                path: "/settings/tags",
                subdropdownMenu: false
            },
            {
                id: 4,
                name: "Email",
                path: "/settings/email",
                subdropdownMenu: false
            },
            {
                id: 5,
                name: "Tasks",
                path: "/settings/tasks",
                subdropdownMenu: false
            },
            {
                id: 6,
                name: "Leads",
                path: "/settings/leads",
                subdropdownMenu: false
            },
            {
                id: 7,
                name: "Support",
                path: "/settings/support",
                subdropdownMenu: false
            },
            {
                id: 8,
                name: "Finance",
                path: "/settings/finance",
                subdropdownMenu: false
            },
            {
                id: 9,
                name: "Gateways",
                path: "/settings/gateways",
                subdropdownMenu: false
            },
            {
                id: 10,
                name: "Customers",
                path: "/settings/customers",
                subdropdownMenu: false
            },
            {
                id: 11,
                name: "Localization",
                path: "/settings/localization",
                subdropdownMenu: false
            },
            {
                id: 12,
                name: "reCAPTCHA",
                path: "/settings/recaptcha",
                subdropdownMenu: false
            },
            {
                id: 13,
                name: "Miscellaneous",
                path: "/settings/miscellaneous",
                subdropdownMenu: false
            },
        ]
    },
    {
        id: 10,
        name: "authentication",
        path: "#",
        icon: 'feather-power',
        dropdownMenu: [
            {
                id: 1,
                name: "login",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/login",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/login/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/login/creative",
                    },
                ]
            },
            {
                id: 2,
                name: "register",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/signup",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/register/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/register/creative",
                    },
                ]
            },
            {
                id: 3,
                name: "Error 404",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/authentication/404/cover",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/404/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/404/creative",
                    },
                ]
            },
            {
                id: 4,
                name: "Reset Pass",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/forgot-password",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/reset/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/reset/creative",
                    },
                ]
            },
            {
                id: 5,
                name: "Verify OTP",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/verify-email",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/verify/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/verify/creative",
                    },
                ]
            },
            {
                id: 6,
                name: "Maintenance",
                path: "#",
                subdropdownMenu: [
                    {
                        id: 1,
                        name: "Cover",
                        path: "/authentication/maintenance/cover",
                    },
                    {
                        id: 2,
                        name: "Minimal",
                        path: "/authentication/maintenance/minimal",
                    },
                    {
                        id: 3,
                        name: "Creative",
                        path: "/authentication/maintenance/creative",
                    },
                ]
            },
        ]
    },
    {
        id: 9,
        name: "Intelligence Hub",
        path: "#",
        icon: 'feather-cpu',
        dropdownMenu: [
            {
                id: 1,
                name: "Smart Query Assistant",
                path: "intelligence/smart-query",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 11,
        name: "Help Center",
        path: "#",
        icon: 'feather-life-buoy',
        dropdownMenu: [
            {
                id: 2,
                name: "Knowledge Base",
                path: "/help/knowledgebase",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Documentations",
                path: "/documentations",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 999,
        name: "logout",
        path: "#",
        icon: 'feather-log-out',
        dropdownMenu: [
            {
                id: 1,
                name: "Logout",
                path: "/logout",
                subdropdownMenu: false
            }
        ]
    },
]
