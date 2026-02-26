import Swal from "sweetalert2";
import withReactContent from 'sweetalert2-react-content'
const MySwal = withReactContent(Swal)

const topTost = (title = 'Action Execute Successfully') => {
    const isDark = document.documentElement.classList.contains('app-skin-dark');
    MySwal.mixin({
        toast: true,
        position: 'top-end',
        backdrop: false,
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: isDark ? '#1e293b' : '#f0fdf4',
        color: 'var(--bs-body-color)',
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
            const bar = toast.querySelector('.swal2-timer-progress-bar');
            if (bar) bar.style.background = '#10b981';
        }
    }).fire({
        icon: 'success',
        title
    });
}

export default topTost
