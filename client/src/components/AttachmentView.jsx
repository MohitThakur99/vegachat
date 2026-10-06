import { useEffect, useState } from 'react';
import { Download, FileText, ImageOff, Loader2 } from 'lucide-react';
import { IMAGE_MIME_TYPES } from '@shared/constants.js';
import { fetchBlob } from '../lib/api.js';
import { formatFileSize } from '../lib/format.js';
import { toastError } from '../store/ui.js';

/**
 * Attachments need the Authorization header, which an <img src> cannot send.
 * They are fetched as blobs instead and shown through object URLs, cached for
 * the lifetime of the page so scrolling does not re-download them.
 *
 * @type {Map<string, Promise<string>>} attachment id -> object URL
 */
const objectUrls = new Map();

function loadObjectUrl(attachmentId) {
  if (!objectUrls.has(attachmentId)) {
    const pending = fetchBlob(`/api/attachments/${attachmentId}`).then((blob) => URL.createObjectURL(blob));
    pending.catch(() => objectUrls.delete(attachmentId));
    objectUrls.set(attachmentId, pending);
  }
  return objectUrls.get(attachmentId);
}

async function download(attachment) {
  try {
    const url = await loadObjectUrl(attachment.id);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
  } catch (err) {
    toastError(err);
  }
}

function ImageAttachment({ attachment }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadObjectUrl(attachment.id)
      .then((objectUrl) => !cancelled && setUrl(objectUrl))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [attachment.id]);

  if (failed) {
    return (
      <span className="mb-1 flex h-32 w-48 max-w-full flex-col items-center justify-center gap-1 rounded-lg bg-black/10 text-xs">
        <ImageOff className="h-5 w-5" />
        Image unavailable
      </span>
    );
  }
  if (!url) {
    return (
      <span className="mb-1 flex h-40 w-56 max-w-full items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="h-5 w-5 animate-spin" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        window.open(url, '_blank', 'noopener');
      }}
      className="mb-1 block"
      aria-label={`Open ${attachment.name}`}
    >
      <img src={url} alt={attachment.name} className="max-h-72 max-w-full rounded-lg object-contain" />
    </button>
  );
}

/**
 * @param {object} props
 * @param {import('@shared/events.js').Attachment} props.attachment
 * @param {boolean} props.own   Rendered inside one of my own (coloured) bubbles.
 */
export default function AttachmentView({ attachment, own }) {
  if (IMAGE_MIME_TYPES.includes(attachment.mimeType)) return <ImageAttachment attachment={attachment} />;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        download(attachment);
      }}
      className={`mb-1 flex w-56 max-w-full items-center gap-3 rounded-lg p-2 text-left transition ${
        own ? 'bg-white/15 hover:bg-white/25' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600'
      }`}
    >
      <FileText className="h-8 w-8 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className="block text-xs opacity-70">{formatFileSize(attachment.size)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-70" />
    </button>
  );
}
