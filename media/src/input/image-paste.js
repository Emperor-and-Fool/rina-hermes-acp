/**
 * Image-paste support for the chat input.
 *
 * VS Code's stable Extension API does not expose a `readImage()` on
 * `vscode.env.clipboard`, so we handle image paste inside the webview
 * (Chromium context) where the browser DOM does give us access to
 * `ClipboardEvent.clipboardData.items` for image MIME types. Pasted
 * images are base64-encoded and staged in a small in-memory buffer;
 * the send path picks them up and forwards them as ACP `image`
 * content blocks alongside the text.
 *
 * Hermes' ACP adapter advertises `promptCapabilities.image = true`,
 * so it accepts these blocks directly (base64 + mimeType).
 */

import { inputEl, inputCompositeEl } from '../core/dom-refs.js';

const PREVIEW_BAR_ID = 'imagePasteBar';

/** Staged images pending send. Each item: { mimeType: string, data: string (base64) }. */
const pending = [];

function ensurePreviewBar() {
    if (!inputCompositeEl) return null;
    let bar = document.getElementById(PREVIEW_BAR_ID);
    if (!bar) {
        bar = document.createElement('div');
        bar.id = PREVIEW_BAR_ID;
        bar.className = 'image-paste-bar';
        inputCompositeEl.insertBefore(bar, inputCompositeEl.firstChild);
    }
    return bar;
}

function renderPreviews() {
    const bar = ensurePreviewBar();
    if (!bar) return;
    bar.innerHTML = '';
    if (pending.length === 0) {
        bar.hidden = true;
        return;
    }
    bar.hidden = false;
    pending.forEach((img, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'image-paste-thumb';

        const el = document.createElement('img');
        el.src = 'data:' + img.mimeType + ';base64,' + img.data;
        el.alt = 'pasted image ' + (i + 1);
        // Rough decoded size for tooltip; base64 expands ~4/3.
        const kb = Math.round((img.data.length * 0.75) / 1024);
        el.title = img.mimeType + ' — ' + kb + ' KB';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'image-paste-remove';
        remove.setAttribute('aria-label', 'Remove image');
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            pending.splice(i, 1);
            renderPreviews();
        });

        wrap.appendChild(el);
        wrap.appendChild(remove);
        bar.appendChild(wrap);
    });
}

/** @param {File} file */
async function stageImageFile(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // btoa needs a binary string; chunked to avoid stack overflow on large images.
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    pending.push({
        mimeType: file.type || 'image/png',
        data: btoa(bin),
    });
    renderPreviews();
}

/**
 * Bind the paste listener on the input element.
 * Non-image paste (plain text) is left to the browser default.
 */
export function bindImagePaste() {
    if (!inputEl) return;
    inputEl.addEventListener('paste', async (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length === 0) return; // let plain-text paste proceed
        e.preventDefault();
        for (const f of files) {
            try {
                await stageImageFile(f);
            } catch (err) {
                console.error('[image-paste] failed to stage image', err);
            }
        }
    });
}

/** Returns the currently staged images (defensive copy). */
export function getPendingImages() {
    return pending.slice();
}

/** True if there is at least one staged image. */
export function hasPendingImages() {
    return pending.length > 0;
}

/** Clear all staged images (call after successful send). */
export function clearPendingImages() {
    pending.length = 0;
    renderPreviews();
}
