import Swal from 'sweetalert2'
import withReactContent from 'sweetalert2-react-content'
const MySwal = withReactContent(Swal)

export const confirmDelete = async (id) => {
    return MySwal.fire({
        title: 'Are you sure?',
        text: 'You want to delete this message!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete!',
        cancelButtonText: 'No, cancel!',
        reverseButtons: true,
        customClass: {
            confirmButton: "btn btn-success m-1",
            cancelButton: "btn btn-danger m-1"
        }
    }).then((result) => {
        if (result.isConfirmed) {
            return { confirmed: true, id };
        } else if (result.dismiss === Swal.DismissReason.cancel) {
            return { confirmed: false };
        }
    });
};