import { HttpResponse } from '@angular/common/http';

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Invoice.pdf';
}

export function saveInvoice(response: HttpResponse<Blob>, fallbackFilename: string): void {
  if (!response.body || response.body.size === 0) throw new Error('Invoice document is empty.');
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const basic = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = fallbackFilename;
  try { filename = encoded ? decodeURIComponent(encoded) : basic || fallbackFilename; }
  catch { filename = fallbackFilename; }

  const objectUrl = URL.createObjectURL(response.body);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFilename(filename);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
