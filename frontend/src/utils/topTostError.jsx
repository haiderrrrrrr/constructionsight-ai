import Swal from "sweetalert2";
import withReactContent from 'sweetalert2-react-content'
const MySwal = withReactContent(Swal)

const getToastConfig = (type = 'error') => {
    const isDark = document.documentElement.classList.contains('app-skin-dark');
    const configs = {
        error: { icon: 'error', barColor: '#ef4444', bgColor: isDark ? '#1e293b' : '#fef2f2' },
        success: { icon: 'success', barColor: '#10b981', bgColor: isDark ? '#1e293b' : '#f0fdf4' },
        warning: { icon: 'warning', barColor: '#f59e0b', bgColor: isDark ? '#1e293b' : '#fffbeb' },
        info: { icon: 'info', barColor: '#3b82f6', bgColor: isDark ? '#1e293b' : '#eff6ff' },
    };
    return configs[type] || configs.error;
};

const topTostError = (title = 'Something went wrong', type = 'error') => {
    const config = getToastConfig(type);
    MySwal.mixin({
        toast: true,
        position: 'top-end',
        backdrop: false,
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: config.bgColor,
        color: 'var(--bs-body-color)',
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
            const bar = toast.querySelector('.swal2-timer-progress-bar');
            if (bar) bar.style.background = config.barColor;
        }
    }).fire({
        icon: config.icon,
        title
    });
}

export default topTostError
