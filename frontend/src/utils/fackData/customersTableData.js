import { customerListStatusOptions, customerListTagsOptions } from "../options"

const tags = customerListTagsOptions
const status = customerListStatusOptions



export const customersTableData = [
    {
        "id": 1,
        "customer": {
            "name": "Alexandra Della",
            "img": "/images/avatar/1.png"
        },
        "email": "alex.della@outlook.com",
        "group": { tags, defaultSelect: [tags[5], tags[6]] },
        "phone": "+1 (375) 9632 548",
        "date": "2023-04-25, 03:42PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 2,
        "customer": {
            "name": "Nancy Elliot",
            "img": ""
        },
        "email": "nancy.elliot@outlook.com",
        "group": { tags, defaultSelect: [tags[5], tags[9], tags[8]] },
        "phone": "(375) 8523 456",
        "date": "2023-04-06, 02:52PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 3,
        "customer": {
            "name": "Green Cute",
            "img": "/images/avatar/2.png"
        },
        "email": "green.cute@outlook.com",
        "group": { tags, defaultSelect: [tags[5], tags[4]] },
        "phone": "(845) 9632 874",
        "date": "2023-04-08, 08:34PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 4,
        "customer": {
            "name": "Henry Leach",
            "img": "/images/avatar/3.png"
        },
        "email": "henry.leach@outlook.com",
        "group": { tags, defaultSelect: [tags[10], tags[3], tags[4]] },
        "phone": "(258) 9514 657",
        "date": "2023-04-10, 05:25PM",
        "status": { status, defaultSelect: "inactive" }
    },
    {
        "id": 5,
        "customer": {
            "name": "Marianne Audrey",
            "img": "/images/avatar/7.png"
        },
        "email": "marine.adrey@outlook.com",
        "group": { tags, defaultSelect: [tags[6], tags[7]] },
        "phone": "(456) 6547 524",
        "date": "2023-04-12, 12:02PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 6,
        "customer": {
            "name": "Alexandra Della",
            "img": "/images/avatar/4.png"
        },
        "email": "alex.della@outlook.com",
        "group": { tags, defaultSelect: [tags[5], tags[0]] },
        "phone": "(375) 8523 456",
        "date": "2023-04-15, 02:40PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 7,
        "customer": {
            "name": "Nancy Elliot",
            "img": "/images/avatar/5.png"
        },
        "email": "nancy.elliot@outlook.com",
        "group": { tags, defaultSelect: [tags[2], tags[3], tags[4]] },
        "phone": "(632) 5486 662",
        "date": "2023-04-25, 03:42PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 8,
        "customer": {
            "name": "Green Cute",
            "img": "/images/avatar/6.png"
        },
        "email": "green.cute@outlook.com",
        "group": { tags, defaultSelect: [tags[6], tags[9]] },
        "phone": "(951) 5478 884",
        "date": "2023-04-14, 03:32PM",
        "status": { status, defaultSelect: "declined" }
    },
    {
        "id": 9,
        "customer": {
            "name": "Henry Leach",
            "img": ""
        },
        "email": "henry.leach@outlook.com",
        "group": { tags, defaultSelect: [tags[1], tags[3], tags[7]] },
        "phone": "(556) 2457 586",
        "date": "2023-04-20, 01:47PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 10,
        "customer": {
            "name": "Alexandra Della",
            "img": "/images/avatar/4.png"
        },
        "email": "alex.della@outlook.com",
        "group": { tags, defaultSelect: [tags[0], tags[5]] },
        "phone": "(554) 2478 663",
        "date": "2023-04-22, 02:12PM",
        "status": { status, defaultSelect: "active" }
    },
    {
        "id": 11,
        "customer": {
            "name": "Alexandra Della",
            "img": ""
        },
        "email": "alex.della@outlook.com",
        "group": { tags, defaultSelect: [tags[8], tags[3], tags[5]] },
        "phone": " (654) 2478 665",
        "date": "2023-04-25, 03:42PM",
        "status": { status, defaultSelect: "declined" }
    },
    {
        "id": 12,
        "customer": {
            "name": "Elliot Nancy",
            "img": "/images/avatar/9.png"
        },
        "email": "elliot.nancy@outlook.com",
        "group": { tags, defaultSelect: [tags[3], tags[10]] },
        "phone": "(554) 2478 663",
        "date": "2023-04-25, 03:42PM",
        "status": { status, defaultSelect: "inactive" }
    },
]