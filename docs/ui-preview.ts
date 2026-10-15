// Example layout only; device discovery and transfers use the extension page.
const addDialog=document.getElementById('add-device-dialog') as HTMLDialogElement;
document.getElementById('preview-add-device')!.addEventListener('click',()=>addDialog.showModal());
