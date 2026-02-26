import Swal from "sweetalert2";
import withReactContent from 'sweetalert2-react-content'
const MySwal = withReactContent(Swal)

const confirmDialog = (title = 'Are you sure?', message = '', confirmText = 'Delete', isDanger = true) => {
    return MySwal.fire({
        title,
        text: message,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: isDanger ? '#ef4444' : '#3b82f6',
        cancelButtonColor: '#6b7280',
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancel',
        backdrop: true,
        allowOutsideClick: false,
        allowEscapeKey: true,
    });
}

export default confirmDialog
