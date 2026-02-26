export const adminMenuList = [
    {
        id: 0,
        name: "dashboards",
        label: "Dashboard",
        path: "#",
        icon: 'feather-airplay',
        dropdownMenu: [
            {
                id: 1,
                name: "Analytics",
                path: "/admin/dashboards/analytics",
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
                path: "/admin/projects/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Create Project",
                path: "/admin/projects/create",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Invitations",
                path: "/admin/invitations/list",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 7.5,
        name: "users",
        path: "#",
        icon: 'feather-users',
        dropdownMenu: [
            {
                id: 1,
                name: "User Management",
                path: "/admin/users/list",
                subdropdownMenu: false
            }
        ]
    },
    {
        id: 8,
        name: "cameras",
        path: "#",
        icon: 'feather-camera',
        dropdownMenu: [
            {
                id: 1,
                name: "Camera Registry",
                path: "/admin/cameras/list",
                subdropdownMenu: false
            },
            {
                id: 2,
                name: "Add Camera",
                path: "/admin/cameras/add",
                subdropdownMenu: false
            },
            {
                id: 3,
                name: "Camera Health",
                path: "/admin/cameras/health",
                subdropdownMenu: false
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
                path: "/admin/intelligence/smart-query",
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
                id: 1,
                name: "Knowledge Base",
                path: "/admin/help/knowledgebase",
                subdropdownMenu: false
            },
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
