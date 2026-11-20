export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const DRIVE_UPLOAD_ERROR = 'อัปโหลดไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วกดบันทึกอีกครั้ง';

export function pdfFileError(file, maxBytes = MAX_PDF_BYTES) {
  if (!file) return 'เลือกไฟล์ PDF';
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'เลือกไฟล์ PDF เท่านั้น';
  if (file.size === 0) return 'ไฟล์ว่าง เลือกไฟล์ PDF ใหม่';
  if (file.size > maxBytes) return 'ไฟล์ใหญ่เกิน 20 MB ลดขนาดไฟล์แล้วเลือกใหม่';
  return null;
}
export function driveFileId(url) {
  try {
    const { origin, pathname, searchParams } = new URL(url);
    if (origin !== 'https://drive.google.com') return null;
    const id = pathname === '/open' ? searchParams.get('id') : pathname.match(/^\/file\/d\/([^/]+)/)?.[1];
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function readPdfBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = reader.onabort = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ เลือกไฟล์แล้วกดบันทึกอีกครั้ง'));
    reader.readAsDataURL(file);
  });
}

export async function driveRequest(sb, url, payload) {
  const { data, error } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error('เซสชันหมดอายุ ออกจากระบบแล้วเข้าใหม่');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 120_000;
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    // Apps Script ไม่ตอบ CORS preflight ที่เกิดจาก upload.onprogress
    const fail = () => reject(new Error(DRIVE_UPLOAD_ERROR));
    xhr.onerror = xhr.ontimeout = xhr.onabort = fail;
    xhr.onload = () => {
      if (xhr.status !== 200) { fail(); return; }
      if (xhr.response?.ok === true) resolve(xhr.response);
      else reject(new Error(xhr.response?.message || DRIVE_UPLOAD_ERROR));
    };
    xhr.send(JSON.stringify({ ...payload, token }));
  });
}

export function trashDriveFiles(sb, url, ids) {
  if (!url) return;
  for (const fileId of new Set(ids.filter(Boolean))) {
    driveRequest(sb, url, { action:'trash', fileId }).catch(() => {});
  }
}

export async function driveUploadUrl(getSetting) {
  try {
    const setting = await getSetting('drive_upload_url');
    const url = typeof setting === 'string' ? setting.trim() : '';
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) ? url : '';
  } catch {
    return '';
  }
}
