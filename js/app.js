// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let portalMutationDepth = 0;

function logActivity(action, productName, detail = '', pid = null) {
    const ts = new Date().toISOString();
    const entry = { action, productName, detail, timestamp: ts, user: currentUser?.name || 'System' };
    ACTIVITY_LOG.unshift(entry);
    if (ACTIVITY_LOG.length > 50) ACTIVITY_LOG.length = 50;
    // Also write to product history
    const p = pid ? PRODUCTS.find(x => x.id === pid) : PRODUCTS.find(x => x.name === productName);
    if (p) {
        if (!p.history) p.history = [];
        p.history.unshift({ action, detail, timestamp: ts, user: entry.user });
    }
    return portalMutationDepth > 0 ? true : Store.save();
}

function capturePortalState() {
    return JSON.parse(JSON.stringify({
        PRODUCTS,
        ACTIVITY_LOG,
        HARDWARE_PRODUCT_TYPES,
        SOFTWARE_CATEGORY_OPTIONS,
        SOFTWARE_INDUSTRY_OPTIONS,
    }));
}

function restorePortalState(snapshot) {
    PRODUCTS = snapshot.PRODUCTS;
    ACTIVITY_LOG = snapshot.ACTIVITY_LOG;
    HARDWARE_PRODUCT_TYPES = snapshot.HARDWARE_PRODUCT_TYPES;
    SOFTWARE_CATEGORY_OPTIONS = snapshot.SOFTWARE_CATEGORY_OPTIONS;
    SOFTWARE_INDUSTRY_OPTIONS = snapshot.SOFTWARE_INDUSTRY_OPTIONS;
}

// Treat each UI mutation like an API transaction. If persistence fails, roll the
// in-memory changes back and report the failure. Callers close their modal only
// after this function returns true, so the user's input remains available.
function commitPortalMutation(
    mutate,
    failureMessage = TOAST_SAVE_FAILURE,
    persist = () => Store.save({ notify: false })
) {
    const snapshot = capturePortalState();
    portalMutationDepth += 1;
    try {
        mutate();
    } catch (error) {
        console.error('Portal mutation failed:', error);
        restorePortalState(snapshot);
        showToast(failureMessage, 'error');
        return false;
    } finally {
        portalMutationDepth -= 1;
    }
    try {
        if (persist()) return true;
    } catch (error) {
        console.error('Portal persistence failed:', error);
    }
    restorePortalState(snapshot);
    showToast(failureMessage, 'error');
    return false;
}

const PORTAL_PERMISSIONS = Object.freeze({
    COMPATIBILITY_READ: 'compatibility.read',
    COMPATIBILITY_UPDATE: 'compatibility.update',
    COMPATIBILITY_AUDIT_READ: 'compatibility.audit.read',
});

// Central permission boundary for future RBAC/API wiring. The v3 demo user has
// wildcard access; future roles can provide an explicit permissions array.
function hasPermission(permission) {
    const permissions = currentUser?.permissions || [];
    return currentUser?.role === 'SUPER_ADMIN' || permissions.includes('*') || permissions.includes(permission);
}

function canViewCompatibility() { return hasPermission(PORTAL_PERMISSIONS.COMPATIBILITY_READ); }
function canManageCompatibility() { return hasPermission(PORTAL_PERMISSIONS.COMPATIBILITY_UPDATE); }
function canManageProduct(p) { return true; /* Existing product permissions remain unchanged in this prototype. */ }
function getSwCategories(p) { return p.categories?.length ? p.categories : (p.sub_category ? [p.sub_category] : []); }
function findCompatRefs(hwId) { return PRODUCTS.filter(p => p.product_type === 'software' && p.status !== 'archived' && (p.compatible_hardware || []).includes(hwId)); }
function getVisibleProducts(type) { return PRODUCTS.filter(p => p.product_type === type && p.status !== 'archived'); }
function getAllProducts(type) { return PRODUCTS.filter(p => p.product_type === type); }
function getUserInitials(name = '') { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function isSuperAdmin() { return true; }
function isAdmin() { return true; }

function statusBadge(s) {
    const m = {
        published: '<span class="badge badge-published">Published</span>',
        draft: '<span class="badge badge-draft">Draft</span>',
        archived: '<span class="badge badge-archived">Archived</span>',
    };
    return m[s] || `<span class="badge badge-zinc">${esc(s)}</span>`;
}

// The matched pair of toasts every save attempt ends in. Keep them in sync
// with the copy in store.js, which reports the same failure from the
// persistence layer. Both are previewable under Settings → Save Toasts.
const TOAST_SAVE_SUCCESS = 'Changes saved.';
const TOAST_SAVE_FAILURE = 'Changes could not be saved. Please try again.';

// Wherever a software product is listed, show the icon the vendor uploaded.
// `fallback` keeps each list's own placeholder look for products that predate
// the icon requirement.
function swListIcon(product, { size, radius }, fallback) {
    if (!product.icon_data) return fallback;
    return `<img src="${esc(product.icon_data)}" alt="" style="width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:cover;flex-shrink:0">`;
}

function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    // Toasts use only two colors: red for errors and blocking messages,
    // green for every success confirmation (including the completion of
    // destructive actions such as a permanent delete).
    const isRed = type === 'error' || type === 'warning' || type === 'danger';
    el.className = `toast-animate text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-lg ${isRed ? 'bg-red-600' : 'bg-emerald-600'}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function showModal(html, wide = false) {
    const root = document.getElementById('modal-root');
    const modalClass = wide === 'edit' ? 'modal-edit' : wide ? 'modal-wide' : '';
    root.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal-card ${modalClass}">${html}</div></div>`;
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

const PRODUCT_ICON_CROP_VIEWPORT = 320;
const PRODUCT_ICON_OUTPUT_SIZE = 512;
let productIconCropState = null;

function closeProductIconCropper() {
    const state = productIconCropState;
    if (state?.objectUrl) URL.revokeObjectURL(state.objectUrl);
    if (state?.inputId) {
        const input = document.getElementById(state.inputId);
        if (input) input.value = '';
    }
    productIconCropState = null;
    const root = document.getElementById('product-icon-crop-root');
    if (root) root.innerHTML = '';
}

function openProductIconCropper(file, context, inputId) {
    closeProductIconCropper();
    const root = document.getElementById('product-icon-crop-root');
    if (!root) return;

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    productIconCropState = {
        file,
        context,
        inputId,
        objectUrl,
        image,
        baseScale: 1,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        dragging: false,
    };
    root.innerHTML = `<div class="icon-crop-backdrop"><div class="icon-crop-dialog"><div class="icon-crop-loading"><i class="ph ph-spinner-gap" style="font-size:22px"></i><div style="margin-top:8px">Preparing image…</div></div></div></div>`;

    image.onload = () => {
        if (!productIconCropState || productIconCropState.objectUrl !== objectUrl) return;
        productIconCropState.baseScale = Math.max(
            PRODUCT_ICON_CROP_VIEWPORT / image.naturalWidth,
            PRODUCT_ICON_CROP_VIEWPORT / image.naturalHeight,
        );
        renderProductIconCropper();
    };
    image.onerror = () => {
        if (!productIconCropState || productIconCropState.objectUrl !== objectUrl) return;
        closeProductIconCropper();
        setProductImageValidationError(inputId, {
            valid: false,
            code: 'format',
            message: PRODUCT_IMAGE_VALIDATION_MESSAGES.file,
            file,
        });
    };
    image.src = objectUrl;
}

function getProductIconCropMetrics() {
    const state = productIconCropState;
    if (!state) return null;
    const width = state.image.naturalWidth * state.baseScale * state.zoom;
    const height = state.image.naturalHeight * state.baseScale * state.zoom;
    return {
        width,
        height,
        x: (PRODUCT_ICON_CROP_VIEWPORT - width) / 2 + state.offsetX,
        y: (PRODUCT_ICON_CROP_VIEWPORT - height) / 2 + state.offsetY,
    };
}

function clampProductIconCropOffset() {
    const state = productIconCropState;
    const metrics = getProductIconCropMetrics();
    if (!state || !metrics) return;
    const maxX = Math.max(0, (metrics.width - PRODUCT_ICON_CROP_VIEWPORT) / 2);
    const maxY = Math.max(0, (metrics.height - PRODUCT_ICON_CROP_VIEWPORT) / 2);
    state.offsetX = Math.max(-maxX, Math.min(maxX, state.offsetX));
    state.offsetY = Math.max(-maxY, Math.min(maxY, state.offsetY));
}

function drawProductIconCropPreview() {
    const canvas = document.getElementById('product-icon-crop-canvas');
    const state = productIconCropState;
    if (!canvas || !state) return;
    clampProductIconCropOffset();
    const metrics = getProductIconCropMetrics();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.image, metrics.x, metrics.y, metrics.width, metrics.height);
}

function setProductIconCropZoom(value) {
    if (!productIconCropState) return;
    productIconCropState.zoom = Math.max(1, Math.min(3, Number(value) || 1));
    clampProductIconCropOffset();
    drawProductIconCropPreview();
}

function resetProductIconCrop() {
    if (!productIconCropState) return;
    productIconCropState.zoom = 1;
    productIconCropState.offsetX = 0;
    productIconCropState.offsetY = 0;
    const zoom = document.getElementById('product-icon-crop-zoom');
    if (zoom) zoom.value = '1';
    drawProductIconCropPreview();
}

function renderProductIconCropper() {
    const state = productIconCropState;
    const root = document.getElementById('product-icon-crop-root');
    if (!state || !root) return;
    root.innerHTML = `
        <div class="icon-crop-backdrop" onclick="if(event.target===this)closeProductIconCropper()">
            <div class="icon-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="product-icon-crop-title">
                <div class="icon-crop-header">
                    <div>
                        <div id="product-icon-crop-title" class="icon-crop-title">Crop Product Icon</div>
                        <div class="icon-crop-subtitle">Move and zoom the image to fit the square area.</div>
                    </div>
                    <button type="button" class="icon-crop-close" aria-label="Close cropper" onclick="closeProductIconCropper()"><i class="ph ph-x"></i></button>
                </div>
                <div class="icon-crop-body">
                    <div class="icon-crop-viewport">
                        <canvas id="product-icon-crop-canvas" width="${PRODUCT_ICON_CROP_VIEWPORT}" height="${PRODUCT_ICON_CROP_VIEWPORT}" aria-label="Product icon crop area"></canvas>
                    </div>
                    <div class="icon-crop-zoom">
                        <i class="ph ph-minus" aria-hidden="true"></i>
                        <input id="product-icon-crop-zoom" type="range" min="1" max="3" step="0.01" value="${state.zoom}" aria-label="Zoom image" oninput="setProductIconCropZoom(this.value)">
                        <i class="ph ph-plus" aria-hidden="true"></i>
                    </div>
                    <div class="icon-crop-hint"><i class="ph ph-hand-grabbing"></i> Drag to reposition · Output ${PRODUCT_ICON_OUTPUT_SIZE} × ${PRODUCT_ICON_OUTPUT_SIZE}px</div>
                </div>
                <div class="icon-crop-actions">
                    <button type="button" class="btn-ghost" onclick="resetProductIconCrop()">Reset</button>
                    <button type="button" class="btn-secondary" onclick="closeProductIconCropper()">Cancel</button>
                    <button type="button" class="btn-primary" onclick="applyProductIconCrop()">Apply Crop</button>
                </div>
            </div>
        </div>`;

    const canvas = document.getElementById('product-icon-crop-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', event => {
        if (!productIconCropState) return;
        productIconCropState.dragging = true;
        productIconCropState.pointerId = event.pointerId;
        productIconCropState.pointerX = event.clientX;
        productIconCropState.pointerY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', event => {
        const activeState = productIconCropState;
        if (!activeState?.dragging || activeState.pointerId !== event.pointerId) return;
        const rect = canvas.getBoundingClientRect();
        const scale = PRODUCT_ICON_CROP_VIEWPORT / rect.width;
        activeState.offsetX += (event.clientX - activeState.pointerX) * scale;
        activeState.offsetY += (event.clientY - activeState.pointerY) * scale;
        activeState.pointerX = event.clientX;
        activeState.pointerY = event.clientY;
        drawProductIconCropPreview();
    });
    const stopDragging = event => {
        const activeState = productIconCropState;
        if (!activeState || activeState.pointerId !== event.pointerId) return;
        activeState.dragging = false;
        canvas.classList.remove('is-dragging');
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    drawProductIconCropPreview();
    document.querySelector('.icon-crop-close')?.focus();
}

function applyProductIconCrop() {
    const state = productIconCropState;
    if (!state) return;
    clampProductIconCropOffset();
    const metrics = getProductIconCropMetrics();
    const output = document.createElement('canvas');
    output.width = PRODUCT_ICON_OUTPUT_SIZE;
    output.height = PRODUCT_ICON_OUTPUT_SIZE;
    const ctx = output.getContext('2d');
    const mimeType = state.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    if (mimeType === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, output.width, output.height);
    }
    const outputScale = PRODUCT_ICON_OUTPUT_SIZE / PRODUCT_ICON_CROP_VIEWPORT;
    ctx.drawImage(
        state.image,
        metrics.x * outputScale,
        metrics.y * outputScale,
        metrics.width * outputScale,
        metrics.height * outputScale,
    );
    const dataUrl = output.toDataURL(mimeType, 0.9);
    const icon = {
        file: state.file,
        name: state.file.name,
        url: dataUrl,
        dataUrl,
        width: PRODUCT_ICON_OUTPUT_SIZE,
        height: PRODUCT_ICON_OUTPUT_SIZE,
        isCropped: true,
    };
    const context = state.context;
    const inputId = state.inputId;
    closeProductIconCropper();
    setCreateError(inputId, '');
    if (context === 'edit') {
        icon.dataPromise = Promise.resolve(dataUrl);
        editSwIcon = icon;
        renderEditSwIconStatus();
        renderEditPreview('software');
    } else {
        createProductState.softwareIcon = icon;
        renderIconStatus();
        renderCreateProductPreview('software');
    }
}

// ── Shared empty state ──
// Centered icon + gray message (+ optional CTA/extra HTML). Every list routes
// its empty state through here so they look and read the same across the app.
function emptyState(icon, message, extra = '') {
    return `<div class="flex flex-col items-center gap-3">
        <i class="ph ${esc(icon)} text-4xl text-[#c7c7cc]"></i>
        <div class="text-sm text-[#86868b] font-semibold">${esc(message)}</div>
        ${extra}
    </div>`;
}

// ── Shared full-page HTTP error screen ──
function renderErrorState(code) {
    const message = (typeof HTTP_ERROR_MESSAGES !== 'undefined' && HTTP_ERROR_MESSAGES[code])
        || 'Something went wrong. Please try again later.';
    return `<section class="http-error-page" role="alert" aria-labelledby="http-error-code">
        <div class="http-error-scene" aria-hidden="true">
            <div class="http-error-ufo">
                <span class="http-error-dome"></span>
                <span class="http-error-ring"></span>
            </div>
            <div class="http-error-beam"></div>
        </div>
        <div class="http-error-content">
            <h1 id="http-error-code" class="http-error-code">${esc(String(code))}</h1>
            <p class="http-error-message">${esc(message)}</p>
            <button type="button" onclick="hideErrorState();navigate('sw-products')" class="http-error-home">
                <i class="ph ph-arrow-left"></i> Take me home
            </button>
        </div>
    </section>`;
}

function showErrorStateDemo(code) {
    const root = document.getElementById('error-state-root');
    if (!root) return;
    closeModal();
    root.innerHTML = renderErrorState(code);
    root.hidden = false;
    document.body.style.overflow = 'hidden';
}

function hideErrorState() {
    const root = document.getElementById('error-state-root');
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════════

// Login does NOT persist — every page load shows the login screen (in-memory only).
function clearLoginFields() {
    const emailEl = document.getElementById('login-email');
    const pwEl = document.getElementById('login-password');
    if (emailEl) { emailEl.value = ''; emailEl.classList.remove('field-error'); }
    if (pwEl) { pwEl.value = ''; pwEl.classList.remove('field-error'); }
    const emailErr = document.getElementById('login-email-error');
    const pwErr = document.getElementById('login-password-error');
    if (emailErr) emailErr.textContent = '';
    if (pwErr) pwErr.textContent = '';
    // Reset password visibility
    if (pwEl) pwEl.type = 'password';
    const eye = document.getElementById('login-pw-eye');
    if (eye) eye.className = 'ph ph-eye';
}

function initPortal() {
    // Keep the user logged in across page reloads (cleared on Logout or tab close)
    try { if (sessionStorage.getItem('aiso-portal-auth') === '1') { enterApp(); return; } } catch (e) {}
    currentUser = null;
    const screen = document.getElementById('login-screen');
    if (screen) screen.style.display = 'flex';
    clearLoginFields();
    updateLoginSubmitState();
    const emailEl = document.getElementById('login-email');
    if (emailEl) emailEl.focus();
}

// ── Login field validation ──
function validateLoginEmail(v) {
    if (!v) return 'Email is required.';
    if (v.length > 100) return 'Email must be 100 characters or fewer.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
    return '';
}
function validateLoginPassword(v) {
    if (!v) return 'Password is required.';
    if (v.length > 100) return 'Password must be 100 characters or fewer.';
    return '';
}

function validateLoginField(which) {
    const input = document.getElementById('login-' + which);
    const errEl = document.getElementById('login-' + which + '-error');
    if (!input) return '';
    const v = (input.value || '').trim();
    const msg = which === 'email' ? validateLoginEmail(v) : validateLoginPassword(v);
    if (errEl) errEl.textContent = msg;
    input.classList.toggle('field-error', !!msg);
    updateLoginSubmitState();
    return msg;
}

function onLoginInput(which) {
    const input = document.getElementById('login-' + which);
    const errEl = document.getElementById('login-' + which + '-error');
    // If the field currently shows an error, re-run to clear it live when valid
    if (errEl && errEl.textContent) {
        const v = (input.value || '').trim();
        const msg = which === 'email' ? validateLoginEmail(v) : validateLoginPassword(v);
        if (!msg) { errEl.textContent = ''; input.classList.remove('field-error'); }
    }
    updateLoginSubmitState();
}

function updateLoginSubmitState() {
    const emailEl = document.getElementById('login-email');
    const pwEl = document.getElementById('login-password');
    const btn = document.getElementById('login-submit');
    if (!btn) return;
    const emailOk = emailEl && !validateLoginEmail((emailEl.value || '').trim());
    const pwOk = pwEl && !validateLoginPassword((pwEl.value || '').trim());
    btn.disabled = !(emailOk && pwOk);
}

function toggleLoginPassword() {
    const pwEl = document.getElementById('login-password');
    const eye = document.getElementById('login-pw-eye');
    if (!pwEl) return;
    const show = pwEl.type === 'password';
    pwEl.type = show ? 'text' : 'password';
    if (eye) eye.className = show ? 'ph ph-eye-slash' : 'ph ph-eye';
}

function login() {
    const btn = document.getElementById('login-submit');
    if (btn && btn.disabled) return;
    const email = (document.getElementById('login-email').value || '').trim();
    const password = (document.getElementById('login-password').value || '').trim();
    const emailEl = document.getElementById('login-email');
    const pwEl = document.getElementById('login-password');
    const emailErr = document.getElementById('login-email-error');
    const pwErr = document.getElementById('login-password-error');
    if (email.toLowerCase() === DEMO_LOGIN.email.toLowerCase() && password === DEMO_LOGIN.password) {
        if (emailErr) emailErr.textContent = '';
        if (pwErr) pwErr.textContent = '';
        if (emailEl) emailEl.classList.remove('field-error');
        if (pwEl) pwEl.classList.remove('field-error');
        enterApp();
    } else {
        const incorrect = 'The Email or Password you entered is incorrect.';
        if (emailEl) emailEl.classList.add('field-error');
        if (pwEl) pwEl.classList.add('field-error');
        if (emailErr) emailErr.textContent = incorrect;
        if (pwErr) pwErr.textContent = incorrect;
    }
}

function enterApp() {
    currentUser = { ...SUPER_ADMIN_USER };
    try { sessionStorage.setItem('aiso-portal-auth', '1'); } catch (e) {}
    if (typeof closeUserMenu === 'function') closeUserMenu();
    const screen = document.getElementById('login-screen');
    if (screen) screen.style.display = 'none';

    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('user-role').textContent = currentUser.label;
    document.getElementById('user-avatar').textContent = getUserInitials(currentUser.name);

    // Build nav
    const navEl = document.getElementById('dynamic-nav');
    navEl.innerHTML = NAV_ITEMS.filter(n => !n.permission || hasPermission(n.permission)).map(n => `
        <button class="nav-item" data-nav="${n.key}" onclick="navigate('${n.key}')">
            <span class="nav-icon"><i class="ph ${n.icon}"></i></span>
            <span>${esc(n.label)}</span>
        </button>
    `).join('');

    // Navigate to first
    navigate(NAV_ITEMS[0].key);
}

function logout() {
    try { sessionStorage.removeItem('aiso-portal-auth'); } catch (e) {}
    closeModal();
    if (typeof closeSwPreview === 'function') closeSwPreview();
    if (typeof closeUserMenu === 'function') closeUserMenu();
    // Staged edits never survive a session.
    paramDraft = null;
    compatDraft = null;
    currentUser = null;
    const screen = document.getElementById('login-screen');
    if (screen) screen.style.display = 'flex';
    clearLoginFields();
    updateLoginSubmitState();
    const emailEl = document.getElementById('login-email');
    if (emailEl) emailEl.focus();
}

function forgotPassword() {
    showToast('Please contact your administrator to reset your password.', 'info');
}

// ═══════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function setPageHeader(title, subtitle, actionHtml) {
    const h = document.getElementById('page-heading');
    if (h) h.innerHTML = title ? `<h2 class="text-2xl font-bold" style="letter-spacing:-0.03em">${esc(title)}</h2>${subtitle ? `<p class="text-sm mt-1" style="color:#86868b">${esc(subtitle)}</p>` : ''}` : '';
    const a = document.getElementById('page-action');
    if (a) a.innerHTML = actionHtml || '';
}

function navigate(key) {
    if (key === 'compatibility' && !canViewCompatibility()) {
        showToast('You do not have permission to view compatibility mappings.', 'error');
        return;
    }
    // Drafts live only while their view is open, so leaving one with staged
    // edits needs an explicit decision from the user.
    const dirtyScope = getDirtyScope();
    if (dirtyScope && dirtyScope !== key) {
        confirmLeavePending(dirtyScope, key);
        return;
    }
    // Rebuild the draft on entry so it starts from the current saved state.
    paramDraft = null;
    compatDraft = null;
    currentView = key;
    // Toggle views
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const targetEl = document.getElementById('view-' + key);
    if (targetEl) targetEl.classList.remove('hidden');

    // Active nav
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.nav-item[data-nav="${key}"]`);
    if (active) active.classList.add('active');

    // Shared header (title + optional subtitle + per-view action)
    const meta = {
        'sw-products': { title: 'Software Products', action: `<button onclick="showCreateProductModal('software')" class="btn-primary" id="sw-create-btn"><i class="ph ph-plus"></i> Add Software</button>` },
        'hw-products': { title: 'Hardware Products', action: `<button onclick="showCreateProductModal('hardware')" class="btn-primary" id="hw-create-btn"><i class="ph ph-plus"></i> Add Hardware</button>` },
        'compatibility': { title: 'Compatibility Mapping', subtitle: 'Manage which published hardware products can be paired with each published software product. Edits are staged until you save them.' },
        'param-center': { title: 'Parameter Center', subtitle: 'System-level parameters managed exclusively by Super Admin. Edits are staged until you save them.' },
        'activity-log': { title: 'Activity Log', subtitle: 'Recent actions performed in this session.', action: `<button onclick="ACTIVITY_LOG=[];Store.save();renderActivityLog();showToast('Log cleared')" class="btn-secondary"><i class="ph ph-trash"></i> Clear</button>` },
        'settings': { title: 'Settings' },
    }[key] || {};
    setPageHeader(meta.title || '', meta.subtitle || '', meta.action || '');

    // Render
    if (key === 'sw-products') renderSwProducts();
    else if (key === 'hw-products') renderHwProducts();
    else if (key === 'compatibility') renderCompatibilityCenter();
    else if (key === 'param-center') renderParamCenter();
    else if (key === 'activity-log') renderActivityLog();
    else if (key === 'settings') renderSettings();
}

// ═══════════════════════════════════════════════════════════════════
// SOFTWARE PRODUCT LIST
// ═══════════════════════════════════════════════════════════════════

const PRODUCT_PAGE_SIZE = 10;
const productPageState = { software: 1, hardware: 1 };

function resetProductPage(type) {
    productPageState[type] = 1;
}

function setProductPage(type, page) {
    const nextPage = Number.parseInt(page, 10);
    if (!Number.isFinite(nextPage)) return;
    productPageState[type] = Math.max(1, nextPage);
    if (type === 'software') renderSwProducts();
    else renderHwProducts();
}

function paginateProductList(list, type) {
    const totalPages = Math.max(1, Math.ceil(list.length / PRODUCT_PAGE_SIZE));
    const currentPage = Math.min(Math.max(productPageState[type] || 1, 1), totalPages);
    productPageState[type] = currentPage;
    const startIndex = (currentPage - 1) * PRODUCT_PAGE_SIZE;
    return {
        currentPage,
        totalPages,
        startIndex,
        items: list.slice(startIndex, startIndex + PRODUCT_PAGE_SIZE),
    };
}

function renderProductPagination(type, totalItems, currentPage, totalPages) {
    const prefix = type === 'software' ? 'sw' : 'hw';
    const target = document.getElementById(`${prefix}-products-pagination`);
    if (!target) return;
    if (totalItems <= PRODUCT_PAGE_SIZE) {
        target.innerHTML = '';
        return;
    }

    const firstItem = (currentPage - 1) * PRODUCT_PAGE_SIZE + 1;
    const lastItem = Math.min(currentPage * PRODUCT_PAGE_SIZE, totalItems);
    const pageStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const pageEnd = Math.min(totalPages, pageStart + 4);
    const pageButtons = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart + i).map(page =>
        `<button type="button" onclick="setProductPage('${type}',${page})" class="${page === currentPage ? 'btn-primary' : 'btn-ghost'}" style="min-width:32px;height:32px;padding:0 9px;justify-content:center">${page}</button>`
    ).join('');
    const navButton = (label, page, disabled = false) => `<button type="button" ${disabled ? 'disabled' : `onclick="setProductPage('${type}',${page})"`} class="btn-ghost" style="font-size:12px">${label}</button>`;

    target.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 4px;border-top:1px solid var(--border-light);flex-wrap:wrap">
        <span style="font-size:12px;color:#86868b;font-weight:500">${firstItem}-${lastItem} of ${totalItems} items</span>
        <div style="display:flex;align-items:center;gap:4px">
            ${navButton('« First', 1, currentPage === 1)}
            ${navButton('‹ Prev', currentPage - 1, currentPage === 1)}
            ${pageButtons}
            ${navButton('Next ›', currentPage + 1, currentPage === totalPages)}
            ${navButton('Last »', totalPages, currentPage === totalPages)}
        </div>
        <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:#86868b;font-weight:500">Go to Page
            <input type="number" min="1" max="${totalPages}" value="${currentPage}" aria-label="Go to page" onchange="setProductPage('${type}',Math.min(Math.max(this.value,1),${totalPages}))" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}" class="input-field" style="width:58px;padding:6px 8px;margin:0;text-align:center">
            <span>/ ${totalPages}</span>
        </label>
    </div>`;
}

function setSwFilter(val) {
    document.getElementById('sw-filter-status').value = val;
    document.querySelectorAll('#sw-filter-tabs .filter-tab').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    resetProductPage('software');
    renderSwProducts();
}

function setHwFilter(val) {
    document.getElementById('hw-filter-status').value = val;
    document.querySelectorAll('#hw-filter-tabs .filter-tab').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    resetProductPage('hardware');
    renderHwProducts();
}

function renderSwProducts() {
    const all = getAllProducts('software');
    const searchQ = (document.getElementById('sw-search')?.value || '').toLowerCase();
    const filterS = document.getElementById('sw-filter-status')?.value || '';
    let list = all.filter(p => {
        if (!filterS && p.status === 'archived') return false;
        if (filterS && p.status !== filterS) return false;
        if (searchQ && !p.name.toLowerCase().includes(searchQ) && !p.vendor_name.toLowerCase().includes(searchQ) && !getSwCategories(p).some(c => c.toLowerCase().includes(searchQ))) return false;
        return true;
    });
    list = applySorting(list, 'software');
    renderStatsBar('sw-stats-bar', all);
    const page = paginateProductList(list, 'software');

    document.getElementById('sw-products-tbody').innerHTML = list.length ? page.items.map(p => `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showSwDetail('${p.id}')">
            <td>
                <div class="flex items-center gap-3">
                    ${swListIcon(p, { size: 36, radius: 10 }, `<div style="width:36px;height:36px;border-radius:10px;background:#f5f5f7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#86868b;flex-shrink:0">${esc(p.name.slice(0,2).toUpperCase())}</div>`)}
                    <div style="min-width:0">
                        <div style="font-weight:600;font-size:13.5px;color:#1d1d1f">${esc(p.name)}</div>
                        ${p.tagline ? `<div style="font-size:12px;color:#86868b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px">${esc(p.tagline)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td><span style="color:#86868b;font-size:13px">${esc(p.vendor_name)}</span></td>
            <td><div style="display:flex;flex-wrap:wrap;gap:4px">${getSwCategories(p).slice(0, 3).map(c => `<span class="badge badge-zinc">${esc(c)}</span>`).join('')}</div></td>
            <td>${statusBadge(p.status)}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <div class="flex items-center gap-0.5 justify-end">
                    ${p.status !== 'archived' ? `<button onclick="showEditProductModal('${p.id}', 'list')" class="btn-ghost" title="Edit"><i class="ph ph-pencil-simple"></i></button>` : ''}
                    ${productActionBtns(p)}
                </div>
            </td>
        </tr>
    `).join('') : `<tr><td colspan="5" class="text-center py-16">${emptyState(
        'ph-app-window',
        searchQ ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searchQ && !filterS ? '<button onclick="showCreateProductModal(\'software\')" class="btn-primary text-xs mt-1"><i class="ph ph-plus-circle"></i> Add Software</button>' : ''
    )}</td></tr>`;
    renderProductPagination('software', list.length, page.currentPage, page.totalPages);
}

function productActionBtns(p) {
    let btns = '';
    if (p.status === 'archived') {
        btns += `<button onclick="restoreProduct('${p.id}')" class="btn-ghost" style="color:#059669" title="Restore"><i class="ph ph-arrow-counter-clockwise"></i></button>`;
        btns += `<button onclick="confirmDeleteProduct('${p.id}')" class="btn-ghost" style="color:#dc2626" title="Delete permanently"><i class="ph ph-trash"></i></button>`;
    } else if (p.status === 'published') {
        // Published products must be unpublished first — no direct Archive.
        btns += `<button onclick="confirmUnpublish('${p.id}')" class="btn-ghost" style="color:#d97706" title="Unpublish"><i class="ph ph-arrow-line-down"></i></button>`;
    } else {
        btns += `<button onclick="togglePublish('${p.id}')" class="btn-ghost" style="color:#059669" title="Publish"><i class="ph ph-arrow-line-up"></i></button>`;
        btns += `<button onclick="confirmArchive('${p.id}')" class="btn-ghost" style="color:#7c3aed" title="Archive"><i class="ph ph-archive"></i></button>`;
    }
    return btns;
}

// ── Sorting ──
function toggleSort(type, key) {
    const s = sortState[type];
    if (s.key === key) { s.dir = s.dir === 'asc' ? 'desc' : 'asc'; }
    else { s.key = key; s.dir = 'asc'; }
    if (type === 'software') renderSwProducts();
    else renderHwProducts();
}

function applySorting(list, type) {
    const s = sortState[type];
    if (!s.key) return list;
    const dir = s.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
        const va = String(a[s.key] || '').toLowerCase();
        const vb = String(b[s.key] || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
    });
}

// ── Stats Bar ──
function renderStatsBar(containerId, all) {
    const target = document.getElementById(containerId);
    if (!target) return;
    const counts = { total: all.length, published: 0, draft: 0, archived: 0 };
    all.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });
    const chip = (label, count, color) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;background:#fafbfc;border:1px solid var(--border-light);min-width:0">
        <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <span style="font-size:12px;font-weight:600;color:#1d1d1f">${count}</span>
        <span style="font-size:11px;color:#86868b;font-weight:500">${label}</span>
    </div>`;
    target.innerHTML = chip('Total', counts.total, '#1d1d1f') + chip('Published', counts.published, '#059669') + chip('Draft', counts.draft, '#6b7280') + chip('Archived', counts.archived, '#7c3aed');
}

// ── Confirm Unpublish ──
function confirmUnpublish(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#fff7ed;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-warning-circle" style="font-size:28px;color:#d97706"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Unpublish "${esc(p.name)}"?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 24px;line-height:1.6">This product will be removed from the storefront immediately. You can republish it anytime.</p>
            <div style="display:flex;gap:10px;justify-content:center">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="doUnpublish('${p.id}')" class="btn-primary" style="background:#d97706"><i class="ph ph-arrow-line-down"></i> Unpublish</button>
            </div>
        </div>`);
}

// ── Confirm Archive ──
// nav: view key to navigate to after a successful archive (used from detail pages).
function confirmArchive(pid, nav = '') {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#f3f0ff;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-archive" style="font-size:28px;color:#7c3aed"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Archive "${esc(p.name)}"?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 24px;line-height:1.6">Archived products can no longer be edited. You can restore it as a draft anytime to make changes.</p>
            <div style="display:flex;gap:10px;justify-content:center">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="archiveProduct('${p.id}', false, '${nav}')" class="btn-primary" style="background:#7c3aed"><i class="ph ph-archive"></i> Archive</button>
            </div>
        </div>`);
}

// ── Compatibility conflict guard (CR1.7) ──
// Strip hwId from every referencing SW product, logging one entry per affected SW.
function removeCompatRefs(hwId) {
    const hw = PRODUCTS.find(x => x.id === hwId);
    findCompatRefs(hwId).forEach(sw => {
        sw.compatible_hardware = (sw.compatible_hardware || []).filter(id => id !== hwId);
        sw.updated_at = new Date().toISOString().slice(0, 10);
        logActivity('Compatibility removed', sw.name, `${hw ? hw.name : hwId} removed from compatible hardware`, sw.id);
    });
}

// Confirm modal shown before unpublish/archive/delete of a HW product that SW products reference.
// confirmJs is the inline onclick that re-invokes the original action with force=true.
function showHwCompatConflictModal(pid, actionLabel, confirmJs) {
    const p = PRODUCTS.find(x => x.id === pid);
    const refNames = findCompatRefs(pid).map(sw => sw.name);
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#fff7ed;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-warning-circle" style="font-size:28px;color:#d97706"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">${esc(actionLabel)} "${esc(p?.name || '')}"?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 12px;line-height:1.6">This hardware is referenced as compatible hardware by:</p>
            <div style="font-size:13px;font-weight:600;color:#1d1d1f;margin:0 0 12px;line-height:1.8">${refNames.map(n => esc(n)).join('<br>')}</div>
            <p style="font-size:13px;color:#86868b;margin:0 0 24px;line-height:1.6">Proceeding will remove it from those products.</p>
            <div style="display:flex;gap:10px;justify-content:center">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="${confirmJs}" class="btn-primary" style="background:#d97706"><i class="ph ph-warning-circle"></i> ${esc(actionLabel)} Anyway</button>
            </div>
        </div>`);
}

function doUnpublish(pid, force = false) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    if (p.product_type === 'hardware' && findCompatRefs(pid).length) {
        if (!force) { showHwCompatConflictModal(pid, 'Unpublish', `doUnpublish('${pid}', true)`); return; }
    }
    const saved = commitPortalMutation(() => {
        if (p.product_type === 'hardware' && findCompatRefs(pid).length) removeCompatRefs(pid);
        p.status = 'draft';
        p.updated_at = new Date().toISOString().slice(0, 10);
        logActivity('Unpublished', p.name, 'Removed from storefront — back to Draft');
    });
    if (!saved) return;
    closeModal();
    showToast(`${p.name} has been unpublished`, 'info');
    reRenderCurrentList();
    const detailView = document.getElementById(`view-${p.product_type === 'software' ? 'sw' : 'hw'}-detail`);
    if (detailView && !detailView.classList.contains('hidden')) {
        if (p.product_type === 'software') showSwDetail(pid);
        else showHwDetail(pid);
    }
}

// ── Archive ──
function archiveProduct(pid, force = false, nav = '') {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    if (p.product_type === 'hardware' && findCompatRefs(pid).length) {
        if (!force) { showHwCompatConflictModal(pid, 'Archive', `archiveProduct('${pid}', true, '${nav}')`); return; }
    }
    const prevLabel = p.status === 'published' ? 'Published' : 'Draft';
    const saved = commitPortalMutation(() => {
        if (p.product_type === 'hardware' && findCompatRefs(pid).length) removeCompatRefs(pid);
        p.status = 'archived';
        p.updated_at = new Date().toISOString().slice(0, 10);
        logActivity('Archived', p.name, `Archived from ${prevLabel}`);
    });
    if (!saved) return;
    closeModal();
    showToast(`${p.name} has been archived.`, 'success');
    if (nav) navigate(nav);
    else reRenderCurrentList();
}

function restoreProduct(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const saved = commitPortalMutation(() => {
        p.status = 'draft';
        p.updated_at = new Date().toISOString().slice(0, 10);
        logActivity('Restored', p.name, 'Restored to Draft');
    });
    if (!saved) return;
    showToast(`${p.name} has been restored as a draft.`, 'success');
    reRenderCurrentList();
}

// ── Delete (Archived only, permanent) ──
function confirmDeleteProduct(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    if (p.status !== 'archived') {
        showToast('Archive this product before permanently deleting it.', 'error');
        return;
    }
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#fef2f2;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-trash" style="font-size:28px;color:#dc2626"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Permanently delete "${esc(p.name)}"?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">This archived product will be permanently removed and cannot be recovered. Type the product name to confirm.</p>
            <input id="delete-confirm-input" type="text" class="input-field" style="max-width:320px;margin:0 auto 20px;text-align:center" placeholder="${esc(p.name)}" oninput="clearDeleteConfirmError()">
            <div style="display:flex;gap:10px;justify-content:center">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button id="delete-confirm-btn" onclick="doDeleteProduct('${p.id}')" class="btn-primary" style="background:#dc2626"><i class="ph ph-trash"></i> Delete Forever</button>
            </div>
        </div>`);
}

// The confirm button stays clickable so a wrong name produces the spec'd
// "Product name does not match." toast instead of a silently dead button.
function clearDeleteConfirmError() {
    document.getElementById('delete-confirm-input')?.classList.remove('field-error');
}

function doDeleteProduct(pid, force = false) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const detailView = document.getElementById(`view-${p.product_type === 'software' ? 'sw' : 'hw'}-detail`);
    const returnToList = detailView && !detailView.classList.contains('hidden')
        ? (p.product_type === 'software' ? 'sw-products' : 'hw-products')
        : '';
    if (p.status !== 'archived') {
        closeModal();
        showToast('Archive this product before permanently deleting it.', 'error');
        return;
    }
    if (!force) {
        const confirmInput = document.getElementById('delete-confirm-input');
        if ((confirmInput?.value || '').trim() !== p.name) {
            confirmInput?.classList.add('field-error');
            confirmInput?.focus();
            showToast('Product name does not match.', 'error');
            return;
        }
    }
    if (p.product_type === 'hardware' && findCompatRefs(pid).length) {
        if (!force) { showHwCompatConflictModal(pid, 'Delete', `doDeleteProduct('${pid}', true)`); return; }
    }
    const name = p.name;
    const saved = commitPortalMutation(() => {
        if (p.product_type === 'hardware' && findCompatRefs(pid).length) removeCompatRefs(pid);
        PRODUCTS.splice(PRODUCTS.indexOf(p), 1);
        logActivity('Deleted', name, 'Product permanently removed');
    });
    if (!saved) return;
    closeModal();
    showToast(`${name} has been permanently deleted.`, 'success');
    if (returnToList) navigate(returnToList);
    else reRenderCurrentList();
}

function reRenderCurrentList() {
    if (currentView === 'sw-products') renderSwProducts();
    else if (currentView === 'hw-products') renderHwProducts();
    else if (currentView === 'param-center') renderParamCenter();
}

// ═══════════════════════════════════════════════════════════════════
// HARDWARE PRODUCT LIST
// ═══════════════════════════════════════════════════════════════════

function renderHwProducts() {
    const all = getAllProducts('hardware');
    const searchQ = (document.getElementById('hw-search')?.value || '').toLowerCase();
    const filterS = document.getElementById('hw-filter-status')?.value || '';
    let list = all.filter(p => {
        if (!filterS && p.status === 'archived') return false;
        if (filterS && p.status !== filterS) return false;
        if (searchQ && !p.name.toLowerCase().includes(searchQ) && !p.vendor_name.toLowerCase().includes(searchQ) && !(p.model || '').toLowerCase().includes(searchQ) && !(p.brand || '').toLowerCase().includes(searchQ)) return false;
        return true;
    });
    list = applySorting(list, 'hardware');
    renderStatsBar('hw-stats-bar', all);
    const page = paginateProductList(list, 'hardware');

    document.getElementById('hw-products-tbody').innerHTML = list.length ? page.items.map(p => `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showHwDetail('${p.id}')">
            <td>
                <div style="font-weight:600;font-size:13.5px;color:#1d1d1f">${esc(p.name)}</div>
                ${(p.product_format || 'standard') === 'standard' ? `<div style="font-size:12px;color:#86868b;margin-top:1px">${esc([p.brand, p.model].filter(Boolean).join(' · '))}</div>` : ''}
            </td>
            <td><span style="color:#86868b;font-size:13px">${esc(p.vendor_name || '—')}</span></td>
            <td><span class="badge badge-zinc">${esc(p.sub_category || 'Hardware')}</span></td>
            <td><span class="format-badge ${(p.product_format || 'standard') === 'standard' ? 'is-standard' : 'is-nonstandard'}" style="font-size:11px"><i class="ph ${(p.product_format || 'standard') === 'standard' ? 'ph-list-bullets' : 'ph-cube'}"></i> ${(p.product_format || 'standard') === 'standard' ? 'Standard' : 'Non-standard'}</span></td>
            <td>${p.is_aidaptiv ? '<span class="badge badge-green">aiDAPTIV</span>' : '<span style="font-size:12px;color:#c7c7cc">—</span>'}</td>
            <td>${statusBadge(p.status)}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <div class="flex items-center gap-0.5 justify-end">
                    ${p.status !== 'archived' ? `<button onclick="showEditProductModal('${p.id}', 'list')" class="btn-ghost" title="Edit"><i class="ph ph-pencil-simple"></i></button>` : ''}
                    ${productActionBtns(p)}
                </div>
            </td>
        </tr>
    `).join('') : `<tr><td colspan="7" class="text-center py-16">${emptyState(
        'ph-hard-drives',
        searchQ ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searchQ && !filterS ? '<button onclick="showCreateProductModal(\'hardware\')" class="btn-primary text-xs mt-1"><i class="ph ph-plus-circle"></i> Add Hardware</button>' : ''
    )}</td></tr>`;
    renderProductPagination('hardware', list.length, page.currentPage, page.totalPages);
}

// ═══════════════════════════════════════════════════════════════════
// PUBLISH / UNPUBLISH (simplified toggle)
// ═══════════════════════════════════════════════════════════════════

function togglePublish(pid, force = false) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p || !canManageProduct(p)) return;

    if (p.status === 'published') {
        if (p.product_type === 'hardware' && findCompatRefs(pid).length) {
            if (!force) { showHwCompatConflictModal(pid, 'Unpublish', `togglePublish('${pid}', true)`); return; }
        }
        const saved = commitPortalMutation(() => {
            if (p.product_type === 'hardware' && findCompatRefs(pid).length) removeCompatRefs(pid);
            p.status = 'draft';
            p.updated_at = new Date().toISOString().slice(0, 10);
            logActivity('Unpublished', p.name, 'Removed from storefront — back to Draft');
        });
        if (!saved) return;
        closeModal();
        showToast(`${p.name} has been unpublished`, 'info');
    } else {
        const saved = commitPortalMutation(() => {
            if (p.product_type === 'software') {
                const staleIds = (p.compatible_hardware || []).filter(hid => {
                    const hw = PRODUCTS.find(x => x.id === hid);
                    return !hw || hw.status !== 'published';
                });
                if (staleIds.length) {
                    // Hard invariant: a SW can only reference published HW (enforced by the published-only
                    // picker + ref-stripping on every HW takedown). Unreachable in normal flow — drop
                    // silently as a data-integrity backstop, no prompt.
                    const staleNames = staleIds.map(hid => PRODUCTS.find(x => x.id === hid)?.name || hid);
                    p.compatible_hardware = p.compatible_hardware.filter(hid => !staleIds.includes(hid));
                    logActivity('Compatibility removed', p.name, `not-published hardware removed on publish: ${staleNames.join(', ')}`, p.id);
                }
            }
            p.status = 'published';
            p.updated_at = new Date().toISOString().slice(0, 10);
            logActivity('Published', p.name, 'Listed on storefront');
        });
        if (!saved) return;
        showToast(`${p.name} is now published.`, 'success');
    }
    reRenderCurrentList();
}

// ═══════════════════════════════════════════════════════════════════
// HARDWARE PREVIEW (storefront card modal)
// ═══════════════════════════════════════════════════════════════════

function showHwPreview(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const fmt = p.product_format || 'standard';
    const specs = p.key_specifications || [];
    const platforms = p.ns_platforms || [];
    const isAidaptiv = p.is_aidaptiv;

    let specSections = '';
    if (fmt === 'nonstandard') {
        if (platforms.length) specSections += `<div class="preview-section"><div class="preview-section-title"><i class="ph ph-cpu" style="color:#7c8ec8"></i> Processor / Platform</div><ul class="hw-spec-list">${platforms.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul></div>`;
        if (specs.length) specSections += `<div class="preview-section"><div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div><ul class="hw-spec-list">${specs.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul></div>`;
    } else {
        if (specs.length) specSections += `<div class="preview-section"><div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div><ul class="hw-spec-list">${specs.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul></div>`;
    }

    ensurePreviewDrawer();
    sdDrawer.innerHTML = `
        <button class="sd-close" type="button" onclick="closeSwPreview()" aria-label="Close preview">&times;</button>
        <div class="sd-body" style="padding:28px 24px 36px">
            <div style="text-align:center;margin-bottom:20px">
                <div style="display:inline-flex;align-items:center;gap:8px">
                    <span class="format-badge ${fmt === 'standard' ? 'is-standard' : 'is-nonstandard'}"><i class="ph ${fmt === 'standard' ? 'ph-list-bullets' : 'ph-cube'}"></i> ${fmt === 'standard' ? 'Standard' : 'Non-standard'}</span>
                    <span style="font-size:12px;color:#86868b;font-weight:500">Storefront Preview</span>
                </div>
            </div>
            <div class="hw-preview-card" style="max-width:380px;margin:0 auto">
                <div class="hw-preview-media">
                    ${p.image_data ? `<img src="${p.image_data}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover">` : `<div class="hw-placeholder-icon" aria-hidden="true">
                        <div class="hw-placeholder-device"></div>
                        <div class="hw-placeholder-device"></div>
                    </div>`}
                </div>
                <div class="hw-preview-body">
                    <h4 class="hw-preview-title">${esc(p.name)}</h4>
                    <div class="hw-preview-category">${esc(p.sub_category || '')}</div>
                    <hr class="hw-preview-divider">
                    ${specSections || '<div style="padding:10px 14px;color:#6d7695;font-size:0.82rem;font-style:italic">No specifications</div>'}
                    ${isAidaptiv ? `<div class="hw-aidaptiv-row">
                        <img src="images/logo-aidaptiv-plus.png" alt="aiDAPTIV" class="hw-aidaptiv-logo" onerror="this.outerHTML='<span style=&quot;font-size:1rem;font-weight:900;color:#1d1d1f&quot;>aiDAPTIV</span>'">
                        <span class="hw-aidaptiv-link">What is aiDaptiv?</span>
                    </div>` : ''}
                    <button type="button" class="hw-preview-cta">Select Hardware</button>
                </div>
            </div>
        </div>`;

    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        sdBackdrop.classList.add('is-open');
        sdDrawer.classList.add('is-open');
    });
}

// ═══════════════════════════════════════════════════════════════════
// SOFTWARE DETAIL
// ═══════════════════════════════════════════════════════════════════

function showSwDetail(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const canEdit = canManageProduct(p);

    const detailRow = (label, value) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-light)"><span style="color:#86868b;font-size:13px;flex-shrink:0">${label}</span><span style="font-weight:600;font-size:13px;text-align:right">${value}</span></div>`;

    document.getElementById('sw-detail-content').innerHTML = `
        <button onclick="navigate('sw-products')" class="btn-link" style="margin-bottom:24px"><i class="ph ph-arrow-left"></i> Back to Software</button>

        <!-- Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px">
            <div style="display:flex;align-items:center;gap:16px">
                ${p.icon_data ? `<img src="${p.icon_data}" alt="${esc(p.name)}" style="width:48px;height:48px;border-radius:14px;object-fit:cover;flex-shrink:0">` : `<div style="width:48px;height:48px;border-radius:14px;background:#f5f5f7;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#86868b">${esc(p.name.slice(0,2).toUpperCase())}</div>`}
                <div style="min-width:0">
                    <div style="display:flex;align-items:center;gap:10px">
                        <h2 style="font-size:1.4rem;font-weight:700;letter-spacing:-0.03em;margin:0">${esc(p.name)}</h2>
                        ${statusBadge(p.status)}
                    </div>
                    ${p.tagline ? `<p style="font-size:14px;color:#6e6e73;line-height:1.5;margin:6px 0 0;max-width:640px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${esc(p.tagline)}">${esc(p.tagline)}</p>` : ''}
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
                ${canEdit && p.status !== 'archived' ? `<button onclick="showEditProductModal('${p.id}', 'detail')" class="btn-secondary"><i class="ph ph-pencil-simple"></i> Edit</button>` : ''}
                ${canEdit && p.status === 'published' ? `<button onclick="confirmUnpublish('${p.id}')" class="btn-secondary" style="color:#d97706"><i class="ph ph-arrow-down"></i> Unpublish</button>` : ''}
                ${canEdit && p.status !== 'published' && p.status !== 'archived' ? `<button onclick="togglePublish('${p.id}');showSwDetail('${p.id}')" class="btn-primary" style="background:#059669"><i class="ph ph-arrow-up"></i> Publish</button>` : ''}
                ${canEdit && p.status !== 'published' && p.status !== 'archived' ? `<button onclick="confirmArchive('${p.id}', 'sw-products')" class="btn-secondary" style="color:#7c3aed"><i class="ph ph-archive"></i> Archive</button>` : ''}
                ${canEdit && p.status === 'archived' ? `<button onclick="restoreProduct('${p.id}');showSwDetail('${p.id}')" class="btn-primary" style="background:#059669"><i class="ph ph-arrow-counter-clockwise"></i> Restore</button>` : ''}
                ${canEdit && p.status === 'archived' ? `<button onclick="confirmDeleteProduct('${p.id}')" class="btn-secondary" style="color:#dc2626"><i class="ph ph-trash"></i> Delete</button>` : ''}
            </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px">
            <!-- Left Column -->
            <div>
                <!-- Key Features -->
                ${p.features?.length ? `
                <section style="margin-top:32px;margin-bottom:32px">
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px">Key Features</div>
                    <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">${p.features.map(f => `<li style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#1d1d1f"><span style="width:5px;height:5px;border-radius:50%;background:#1d1d1f;flex-shrink:0;margin-top:8px"></span><span>${esc(f)}</span></li>`).join('')}</ul>
                </section>
                <div style="border-top:1px solid var(--border-light)"></div>` : ''}

                <!-- Industries -->
                ${p.industries?.length ? `
                <section style="margin-top:32px">
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px">Applicable Industries</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px">${p.industries.map(i => `<span class="badge badge-zinc">${esc(i)}</span>`).join('')}</div>
                </section>` : ''}
            </div>

            <!-- Right Column -->
            <div>
                <!-- Product Info -->
                <section style="margin-bottom:32px">
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Product Info</div>
                    ${detailRow('Vendor', esc(p.vendor_name || '—'))}
                    ${detailRow('Website', p.officialUrl
                        ? `<a href="${esc(normalizeProductUrl(p.officialUrl))}" target="_blank" rel="noopener noreferrer" title="${esc(normalizeProductUrl(p.officialUrl))}" style="color:#1d2e7b;text-decoration:underline;text-underline-offset:3px;word-break:break-all">${esc(formatProductUrlLabel(p.officialUrl))}</a>`
                        : '—')}
                    ${detailRow('Category', esc(getSwCategories(p).join(', ')))}
                    ${detailRow('License', p.license_offer ? esc(p.license_offer) : '—')}
                    ${detailRow('Created', esc(p.created_at))}
                    ${detailRow('Updated', esc(p.updated_at))}
                </section>
            </div>
        </div>
        ${renderProductHistory(p)}
    `;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-sw-detail').classList.remove('hidden');
    setPageHeader('', '', '');
}

// ═══════════════════════════════════════════════════════════════════
// HARDWARE DETAIL
// ═══════════════════════════════════════════════════════════════════

function showHwDetail(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const canEdit = canManageProduct(p);

    const detailRow = (label, value) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-light)"><span style="color:#86868b;font-size:13px;flex-shrink:0">${label}</span><span style="font-weight:600;font-size:13px;text-align:right">${value}</span></div>`;

    document.getElementById('hw-detail-content').innerHTML = `
        <button onclick="navigate('hw-products')" class="btn-link" style="margin-bottom:24px"><i class="ph ph-arrow-left"></i> Back to Hardware</button>

        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px">
            <div style="display:flex;align-items:center;gap:16px">
                <div>
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                        <h2 style="font-size:1.4rem;font-weight:700;letter-spacing:-0.03em;margin:0">${esc(p.name)}</h2>
                        ${statusBadge(p.status)}
                        <span class="format-badge ${(p.product_format||'standard') === 'standard' ? 'is-standard' : 'is-nonstandard'}"><i class="ph ${(p.product_format||'standard') === 'standard' ? 'ph-list-bullets' : 'ph-cube'}"></i> ${(p.product_format||'standard') === 'standard' ? 'Standard' : 'Non-standard'}</span>
                        ${p.is_aidaptiv ? '<span class="badge badge-green">aiDAPTIV</span>' : ''}
                    </div>
                    <div style="font-size:13px;color:#86868b;margin-top:3px">${esc(p.vendor_name || '—')}${p.brand ? ' · ' + esc(p.brand) : ''}${p.model ? ' ' + esc(p.model) : ''}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
                ${canEdit && p.status !== 'archived' ? `<button onclick="showEditProductModal('${p.id}', 'detail')" class="btn-secondary"><i class="ph ph-pencil-simple"></i> Edit</button>` : ''}
                ${canEdit && p.status === 'published' ? `<button onclick="confirmUnpublish('${p.id}')" class="btn-secondary" style="color:#d97706"><i class="ph ph-arrow-down"></i> Unpublish</button>` : ''}
                ${canEdit && p.status !== 'published' && p.status !== 'archived' ? `<button onclick="togglePublish('${p.id}');showHwDetail('${p.id}')" class="btn-primary" style="background:#059669"><i class="ph ph-arrow-up"></i> Publish</button>` : ''}
                ${canEdit && p.status !== 'published' && p.status !== 'archived' ? `<button onclick="confirmArchive('${p.id}', 'hw-products')" class="btn-secondary" style="color:#7c3aed"><i class="ph ph-archive"></i> Archive</button>` : ''}
                ${canEdit && p.status === 'archived' ? `<button onclick="restoreProduct('${p.id}');showHwDetail('${p.id}')" class="btn-primary" style="background:#059669"><i class="ph ph-arrow-counter-clockwise"></i> Restore</button>` : ''}
                ${canEdit && p.status === 'archived' ? `<button onclick="confirmDeleteProduct('${p.id}')" class="btn-secondary" style="color:#dc2626"><i class="ph ph-trash"></i> Delete</button>` : ''}
            </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px">
            <div>
                ${(p.product_format || 'standard') !== 'standard' && (p.ns_platforms || []).length ? `
                <div style="border-top:1px solid var(--border-light)"></div>
                <section style="margin-top:32px;margin-bottom:32px">
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px">Processor / Platform</div>
                    <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">
                        ${(p.ns_platforms || []).map(s => '<li style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#1d1d1f"><span style="width:5px;height:5px;border-radius:50%;background:#1d1d1f;flex-shrink:0;margin-top:8px"></span><span>' + esc(s) + '</span></li>').join('')}
                    </ul>
                </section>` : ''}

                ${(p.key_specifications || []).length ? `
                <div style="border-top:1px solid var(--border-light)"></div>
                <section style="margin-top:32px;margin-bottom:32px">
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px">Key Specifications</div>
                    <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">
                        ${(p.key_specifications || []).map(s => '<li style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#1d1d1f"><span style="width:5px;height:5px;border-radius:50%;background:#1d1d1f;flex-shrink:0;margin-top:8px"></span><span>' + esc(s) + '</span></li>').join('')}
                    </ul>
                </section>` : ''}

            </div>

            <div>
                <section>
                    <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Product Info</div>
                    ${detailRow('Format', '<span class="format-badge ' + ((p.product_format||'standard') === 'standard' ? 'is-standard' : 'is-nonstandard') + '"><i class="ph ' + ((p.product_format||'standard') === 'standard' ? 'ph-list-bullets' : 'ph-cube') + '"></i> ' + ((p.product_format||'standard') === 'standard' ? 'Standard' : 'Non-standard') + '</span>')}
                    ${(p.product_format || 'standard') === 'standard' ? detailRow('Brand', esc(p.brand)) : ''}
                    ${(p.product_format || 'standard') === 'standard' ? detailRow('Model', esc(p.model)) : ''}
                    ${detailRow('Category', esc(p.sub_category))}
                    ${detailRow('aiDAPTIV', p.is_aidaptiv ? '<span class="badge badge-green">Yes</span>' : 'No')}
                    ${detailRow('Created', esc(p.created_at))}
                    ${detailRow('Updated', esc(p.updated_at))}
                </section>
            </div>
        </div>
        ${renderProductHistory(p)}
    `;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-hw-detail').classList.remove('hidden');
    setPageHeader('', '', '');
}

// ═══════════════════════════════════════════════════════════════════
// SOFTWARE PREVIEW (front-end card preview)
// ═══════════════════════════════════════════════════════════════════

// ── Software Preview Drawer (v5 aligned) ──
let sdBackdrop = null, sdDrawer = null;

function ensurePreviewDrawer() {
    if (sdBackdrop && sdDrawer) return;
    sdBackdrop = document.createElement('div');
    sdBackdrop.className = 'sd-backdrop';
    sdBackdrop.setAttribute('aria-hidden', 'true');
    sdBackdrop.addEventListener('click', closeSwPreview);
    sdDrawer = document.createElement('div');
    sdDrawer.className = 'sd-drawer';
    sdDrawer.setAttribute('role', 'dialog');
    sdDrawer.setAttribute('aria-modal', 'true');
    sdDrawer.setAttribute('aria-label', 'Software detail preview');
    document.body.appendChild(sdBackdrop);
    document.body.appendChild(sdDrawer);
}

function showSwPreview(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    ensurePreviewDrawer();
    const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    const SVG_FEATURES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const SVG_INDUSTRIES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';

    const featuresHtml = p.features?.length ? `
        <section class="sd-meta-block">
            <div class="sd-meta-title">${SVG_FEATURES} Key Features</div>
            <ul class="sd-feature-list">${p.features.map(f =>
                `<li class="sd-feature-item"><span class="sd-feature-dot"></span><span>${esc(f)}</span></li>`
            ).join('')}</ul>
        </section>` : '';

    const industriesHtml = p.industries?.length ? `
        <section class="sd-meta-block">
            <div class="sd-meta-title">${SVG_INDUSTRIES} Applicable Industries</div>
            <div class="sd-industry-list">${p.industries.map(i =>
                `<span class="sd-industry-chip">${esc(i)}</span>`
            ).join('')}</div>
        </section>` : '';

    const savedPhotos = (p.photos_data || []).filter(Boolean);
    savedSwGallery = { photos: savedPhotos, index: 0 };
    const galleryHtml = savedPhotos.length ? `
        <div>
            <div class="sd-gallery">
                <img class="sd-gallery-img" id="sd-saved-gallery-img" src="${savedPhotos[0]}" alt="${esc(p.name)}">
                ${savedPhotos.length > 1 ? `<span class="sd-gallery-nav prev" onclick="slideSavedSwGallery(-1)"><i class="ph ph-caret-left"></i></span>
                <span class="sd-gallery-nav next" onclick="slideSavedSwGallery(1)"><i class="ph ph-caret-right"></i></span>` : ''}
            </div>
            ${savedPhotos.length > 1 ? `<div class="sd-gallery-dots" id="sd-saved-gallery-dots">${savedPhotos.map((_, i) => `<span class="sd-gallery-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
        </div>` : '';

    // Packaging no longer differentiates the storefront call to action.
    const actionHtml = '<button class="sd-action-primary">Select</button>';

    sdDrawer.innerHTML = `
        <button class="sd-close" type="button" onclick="closeSwPreview()" aria-label="Close preview">&times;</button>
        <div class="sd-body">
            <div class="sd-hero">
                <div class="sd-hero-header">
                    <div class="sd-mark">${p.icon_data ? `<img src="${p.icon_data}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:20px">` : esc(initials)}</div>
                    <div style="min-width:0;flex:1">
                        <p class="sd-company">${esc(p.vendor_name)}</p>
                        <h2 class="sd-name">${esc(p.name)}</h2>
                        ${renderSwLicenseBadge(p.license_offer)}
                    </div>
                </div>
                <p class="sd-tagline">${esc(p.tagline || getSwCategories(p).join(', '))}</p>
            </div>
            <div class="sd-content">
                ${featuresHtml}
                ${galleryHtml}
                ${industriesHtml}
            </div>
        </div>
        <div class="sd-action-footer">
            ${actionHtml}
        </div>`;

    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        sdBackdrop.classList.add('is-open');
        sdDrawer.classList.add('is-open');
    });
}

let savedSwGallery = { photos: [], index: 0 };

function slideSavedSwGallery(dir) {
    const total = savedSwGallery.photos.length;
    if (total <= 1) return;
    savedSwGallery.index = (savedSwGallery.index + dir + total) % total;
    const img = document.getElementById('sd-saved-gallery-img');
    if (img) img.src = savedSwGallery.photos[savedSwGallery.index];
    document.querySelectorAll('#sd-saved-gallery-dots .sd-gallery-dot').forEach((d, i) => d.classList.toggle('active', i === savedSwGallery.index));
}

function closeSwPreview() {
    if (!sdBackdrop || !sdDrawer) return;
    sdBackdrop.classList.remove('is-open');
    sdDrawer.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { if (sdDrawer) sdDrawer.innerHTML = ''; }, 340);
}

// ═══════════════════════════════════════════════════════════════════
// CREATE / EDIT PRODUCT MODAL
// ═══════════════════════════════════════════════════════════════════

function createField(id, label, opts = {}) {
    const required = opts.required ? ' <span class="req">*</span>' : '';
    const max = opts.maxlength ? ` maxlength="${opts.maxlength}"` : '';
    const placeholder = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '';
    const type = opts.type || 'text';
    const value = opts.value ? ` value="${esc(opts.value)}"` : '';
    const input = opts.maxlength
        ? `<div class="relative">
            <input id="${id}" type="${type}" class="input-field pr-14" ${opts.required ? 'required' : ''}${max}${placeholder}${value} oninput="updateCharCounter('${id}')">
            <span id="${id}-count" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#86868b] pointer-events-none">${(opts.value || '').length}/${opts.maxlength}</span>
        </div>`
        : `<input id="${id}" type="${type}" class="input-field" ${opts.required ? 'required' : ''}${max}${placeholder}${value}>`;
    return `<div class="${opts.wrapClass || ''}">
        <label for="${id}" class="field-label">${label}${required}</label>
        ${input}
        ${opts.hint ? `<div class="field-hint">${esc(opts.hint)}</div>` : ''}
        <div id="${id}-error" class="field-error-text"></div>
    </div>`;
}

function createTextArea(id, label, opts = {}) {
    const required = opts.required ? ' <span class="req">*</span>' : '';
    const max = opts.maxlength ? ` maxlength="${opts.maxlength}"` : '';
    const placeholder = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '';
    const oninput = opts.maxlength ? ` oninput="updateCharCounter('${id}')"` : '';
    return `<div class="${opts.wrapClass || ''}">
        <label for="${id}" class="field-label">${label}${required}</label>
        <textarea id="${id}" rows="${opts.rows || 3}" class="input-field" ${opts.required ? 'required' : ''}${max}${placeholder}${oninput}></textarea>
        ${opts.maxlength ? `<div id="${id}-count" class="field-hint" style="text-align:right">0/${opts.maxlength}</div>` : ''}
        ${opts.hint ? `<div class="field-hint">${esc(opts.hint)}</div>` : ''}
        <div id="${id}-error" class="field-error-text"></div>
    </div>`;
}

function createFormSection(icon, title, subtitle, body) {
    return `<section class="form-section">
        <div class="form-section-head">
            <div>
                <div class="form-section-title"><i class="ph ${esc(icon)}"></i><span>${esc(title)}</span></div>
                ${subtitle ? `<div class="form-section-subtitle">${esc(subtitle)}</div>` : ''}
            </div>
        </div>
        <div class="form-section-body">${body}</div>
    </section>`;
}

function setCreateError(id, message = '') {
    const el = document.getElementById(id);
    const err = document.getElementById(`${id}-error`);
    if (el) el.classList.toggle('field-error', !!message);
    if (el?.type === 'file') el.closest('.file-upload-wrap')?.classList.toggle('field-error', !!message);
    if (err) err.textContent = message;
}

function valueOf(id) {
    return document.getElementById(id)?.value?.trim() || '';
}

function validateProductImageFiles(files, { currentCount = 0, maxCount = null, required = false } = {}) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) {
        return required
            ? { valid: false, code: 'required', message: PRODUCT_IMAGE_VALIDATION_MESSAGES.required }
            : { valid: true, code: null, message: '' };
    }

    const invalidFormatFile = selectedFiles.find(file => {
        const nameOk = /\.(jpe?g|png)$/i.test(file.name || '');
        const typeOk = !file.type || ['image/jpeg', 'image/jpg', 'image/png'].includes(file.type);
        return !nameOk || !typeOk;
    });
    if (invalidFormatFile) {
        return { valid: false, code: 'format', message: PRODUCT_IMAGE_VALIDATION_MESSAGES.file, file: invalidFormatFile };
    }

    const oversizedFile = selectedFiles.find(file => Number(file.size || 0) > PRODUCT_IMAGE_MAX_BYTES);
    if (oversizedFile) {
        return { valid: false, code: 'size', message: PRODUCT_IMAGE_VALIDATION_MESSAGES.file, file: oversizedFile };
    }

    if (maxCount !== null && currentCount + selectedFiles.length > maxCount) {
        return { valid: false, code: 'count', message: PRODUCT_IMAGE_VALIDATION_MESSAGES.count };
    }

    return { valid: true, code: null, message: '' };
}

function setProductImageValidationError(id, validation) {
    const fileName = validation.file?.name;
    const message = fileName ? `${fileName}: ${validation.message}` : validation.message;
    if (validation.code === 'count') {
        setCreateError(id, '');
        showToast(message, 'error');
        return;
    }
    setCreateError(id, message);
}

function getMatchingVendorId(vendorName, vendorType) {
    // Vendor is a free-text field. Link to an existing org only on an exact
    // name match; otherwise leave vendor_id null (vendor_name is the source of truth).
    const target = String(vendorName || '').trim().toLowerCase();
    const org = ORGS.find(o => o.type === 'vendor' && o.vendor_type === vendorType && o.name.toLowerCase() === target);
    return org ? org.id : null;
}

function renderSoftwareFeatureInputs() {
    return Array.from({ length: SOFTWARE_FEATURE_MAX_ITEMS }, (_, i) => `
        <div class="relative">
            <input id="new-p-feature-${i}" class="input-field pr-16" maxlength="${SOFTWARE_FEATURE_MAX_CHARS}" placeholder="Feature ${i + 1}">
            <span id="new-p-feature-${i}-count" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#86868b]">0/${SOFTWARE_FEATURE_MAX_CHARS}</span>
        </div>`).join('');
}

function collectHardwareSpecs() {
    return collectNsItems('new-p-spec');
}

// Standard Key Specs use the same dynamic Add-button machinery as non-standard,
// but count only their own single list (not a combined Platform+Spec total).
function updateSpecCounter() {
    const count = document.getElementById('new-p-spec-list')?.querySelectorAll('.ns-row').length || 0;
    const el = document.getElementById('spec-item-counter');
    if (el) {
        el.textContent = `${count} / ${HW_KEY_SPEC_MAX_ITEMS} items used`;
        el.style.color = count >= HW_KEY_SPEC_MAX_ITEMS ? '#ff3b30' : '#86868b';
    }
}

function addSpecRow() {
    const container = document.getElementById('new-p-spec-list');
    if (!container) return;
    const existing = container.querySelectorAll('.ns-row').length;
    if (existing >= HW_KEY_SPEC_MAX_ITEMS) { showToast('Max 8 items reached', 'error'); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = nsRowHtml(`new-p-spec-${existing}`, 'e.g. Intel Xeon 6730P 32 Core', '', 'updateSpecCounter()', 'renderHardwareCreatePreview()');
    container.appendChild(tmp.firstElementChild);
    updateSpecCounter();
}

function collectSoftwareFeatures() {
    return Array.from({ length: SOFTWARE_FEATURE_MAX_ITEMS }, (_, i) => valueOf(`new-p-feature-${i}`)).filter(Boolean);
}

function getCheckedValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map(el => el.value);
}

const SW_CATEGORY_MAX = 3;

function renderSwCategoryChecks(containerId, checkedValues = []) {
    const labels = SOFTWARE_CATEGORY_OPTIONS.filter(o => o.is_active).map(o => o.label);
    // Keep currently-assigned categories visible even if no longer an active option
    checkedValues.forEach(v => { if (!labels.includes(v)) labels.push(v); });
    return `<div id="${containerId}" class="flex flex-wrap gap-2">
        ${labels.map(l => `<label class="preview-pill cursor-pointer"><input type="checkbox" value="${esc(l)}" class="mr-2 accent-aiso" ${checkedValues.includes(l) ? 'checked' : ''} onchange="updateSwCategoryLimit('${containerId}')">${esc(l)}</label>`).join('')}
    </div>
    <div id="${containerId}-count" class="field-hint">${checkedValues.length}/${SW_CATEGORY_MAX} selected</div>
    <div id="${containerId}-error" class="field-error-text"></div>`;
}

function updateSwCategoryLimit(containerId) {
    const boxes = Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]`));
    const checked = boxes.filter(b => b.checked).length;
    boxes.forEach(b => { b.disabled = !b.checked && checked >= SW_CATEGORY_MAX; });
    const counter = document.getElementById(`${containerId}-count`);
    if (counter) counter.textContent = `${checked}/${SW_CATEGORY_MAX} selected`;
}

const SW_LICENSE_NONE = '';

// Licensing offers are static per the alliance agreement clause — three fixed
// choices plus "Not specified", hardcoded in the software form (no longer
// Parameter Center-managed). `license_offer` stores the storefront label; the
// trial option embeds the vendor-entered day count (e.g. "30-day free trial").
const SW_LICENSE_TRIAL_KEY = 'trial';
const SW_LICENSE_TRIAL_PATTERN = /^(\d+)-day free trial$/;
const SW_LICENSE_TYPES = [
    { key: 'first-year', label: 'First year free', bg: '#ecfdf5', text: '#047857' },
    { key: SW_LICENSE_TRIAL_KEY, label: 'N-day free trial', bg: 'rgba(29,46,123,0.08)', text: '#1d2e7b' },
    { key: 'poc', label: 'Free during POC', bg: '#f5f3ff', text: '#6d28d9' },
];
// Offers saved before the palette became static render in neutral gray.
const SW_LICENSE_FALLBACK_COLOR = { bg: '#f5f5f7', text: '#52525b' };

function getLicenseOfferColor(offer) {
    if (SW_LICENSE_TRIAL_PATTERN.test(offer)) return SW_LICENSE_TYPES.find(t => t.key === SW_LICENSE_TRIAL_KEY);
    return SW_LICENSE_TYPES.find(t => t.label === offer) || SW_LICENSE_FALLBACK_COLOR;
}

// Trial day counts are capped at four digits. Both product forms are
// novalidate, so neither `max` nor `maxlength` is enforced by the browser —
// onSwLicenseTrialInput does it while the vendor types, and
// validateSwLicenseSelection re-checks on submit.
const SW_LICENSE_TRIAL_MAX_DIGITS = 4;
const SW_LICENSE_TRIAL_MAX_DAYS = 9999;

// `selected` is the stored offer label. Pass hasOffer: true when the product
// actually carries a license_offer property, so an empty string reads as a
// deliberate "Not specified" rather than a field that was never filled in.
function renderSwLicenseRadios(containerId, selected = '', { hasOffer = false } = {}) {
    const trialDays = (selected.match(SW_LICENSE_TRIAL_PATTERN) || [])[1] || '';
    // Nothing is pre-selected on a fresh form: picking an offer is a required,
    // explicit choice rather than a silent default.
    const selectedKey = trialDays
        ? SW_LICENSE_TRIAL_KEY
        : (selected
            ? (SW_LICENSE_TYPES.find(t => t.label === selected)?.key ?? null)
            : (hasOffer ? SW_LICENSE_NONE : null));
    const radio = (value, inner, checked) => `<label class="preview-pill cursor-pointer" style="align-items:center"><input type="radio" name="${containerId}" value="${value}" class="mr-2 accent-aiso" ${checked ? 'checked' : ''} onchange="setCreateError('${containerId}', '')">${inner}</label>`;
    const dot = t => `<span style="width:8px;height:8px;border-radius:50%;background:${t.text};margin-right:6px;flex-shrink:0"></span>`;
    // Focusing or typing in the day-count field implicitly picks the trial offer.
    const typeInner = t => t.key === SW_LICENSE_TRIAL_KEY
        ? `${dot(t)}<input id="${containerId}-days" type="text" inputmode="numeric" maxlength="${SW_LICENSE_TRIAL_MAX_DIGITS}" value="${trialDays}" placeholder="N" style="width:62px;border:1px solid #e8eaed;border-radius:6px;padding:1px 4px;font-size:12px;text-align:center;margin-right:4px" onfocus="selectSwLicenseTrial('${containerId}')" oninput="onSwLicenseTrialInput(this,'${containerId}')">-day free trial`
        : `${dot(t)}${esc(t.label)}`;
    return `<div id="${containerId}" class="flex flex-wrap gap-2">
        ${SW_LICENSE_TYPES.map(t => radio(t.key, typeInner(t), t.key === selectedKey)).join('')}
        ${radio(SW_LICENSE_NONE, 'Not specified', selectedKey === SW_LICENSE_NONE)}
    </div>
    <div id="${containerId}-error" class="field-error-text"></div>`;
}

function onSwLicenseTrialInput(input, containerId) {
    input.value = input.value.replace(/\D/g, '').slice(0, SW_LICENSE_TRIAL_MAX_DIGITS);
    selectSwLicenseTrial(containerId);
}

function selectSwLicenseTrial(containerId) {
    const radio = document.querySelector(`#${containerId} input[value="${SW_LICENSE_TRIAL_KEY}"]`);
    if (radio && !radio.checked) {
        radio.checked = true;
        // Fire the same change event a manual click would, so the live preview
        // bindings attached in setup*Bindings re-render.
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setCreateError(containerId, '');
}

function getSelectedLicense(containerId) {
    const key = document.querySelector(`#${containerId} input[type="radio"]:checked`)?.value || SW_LICENSE_NONE;
    if (key === SW_LICENSE_NONE) return '';
    if (key === SW_LICENSE_TRIAL_KEY) {
        const days = parseInt(document.getElementById(`${containerId}-days`)?.value, 10);
        return days > 0 ? `${days}-day free trial` : '';
    }
    return SW_LICENSE_TYPES.find(t => t.key === key)?.label || '';
}

// An offer must be picked, and the trial offer additionally needs a day count
// of 1..SW_LICENSE_TRIAL_MAX_DAYS.
function validateSwLicenseSelection(containerId) {
    const checked = document.querySelector(`#${containerId} input[type="radio"]:checked`);
    if (!checked) {
        setCreateError(containerId, 'Please select a Licensing Option.');
        return false;
    }
    if (checked.value === SW_LICENSE_TRIAL_KEY) {
        const days = parseInt(document.getElementById(`${containerId}-days`)?.value, 10);
        if (!(days > 0 && days <= SW_LICENSE_TRIAL_MAX_DAYS)) {
            setCreateError(containerId, `Please enter the number of trial days (1-${SW_LICENSE_TRIAL_MAX_DAYS}).`);
            return false;
        }
    }
    setCreateError(containerId, '');
    return true;
}

function renderSwLicenseBadge(offer) {
    if (!offer) return '';
    const color = getLicenseOfferColor(offer);
    return `<span class="sd-license-badge" style="background:${color.bg};color:${color.text}">${esc(offer)}</span>`;
}

/* ── Official website URL ── */
const SW_URL_MAX_CHARS = 200;

// Accepts what people actually type ("www.example.com") and stores a complete
// URL. Returns '' for blank input — the field is optional.
function normalizeProductUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isValidProductUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return true; // optional field
    try {
        const url = new URL(normalizeProductUrl(value));
        return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname.includes('.');
    } catch {
        return false;
    }
}

// Drops the scheme and any trailing slash so the storefront shows a domain
// rather than a full URL. The complete URL stays in href/title.
function formatProductUrlLabel(url) {
    return String(url ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

const SVG_GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';

// The live preview mirrors the storefront layout, where nothing is clickable —
// so it renders a non-interactive span and keeps a placeholder row while the
// field is empty, so typing a URL never shifts the footer.
function renderSwSiteLink(url, { placeholder = '' } = {}) {
    const value = String(url ?? '').trim();
    // A half-typed or malformed value can never reach the storefront (save is
    // blocked), so the preview keeps the placeholder rather than mocking up a
    // link that will not exist.
    if (!isValidProductUrl(value)) {
        return placeholder
            ? `<span class="sd-site-link is-empty">${SVG_GLOBE}<span>${esc(placeholder)}</span></span>`
            : '';
    }
    if (!value) {
        return placeholder
            ? `<span class="sd-site-link is-empty">${SVG_GLOBE}<span>${esc(placeholder)}</span></span>`
            : '';
    }
    const full = normalizeProductUrl(value);
    return `<span class="sd-site-link" title="${esc(full)}">${SVG_GLOBE}<span>${esc(formatProductUrlLabel(full))}</span></span>`;
}

function updateCharCounter(inputId) {
    const el = document.getElementById(inputId);
    const counter = document.getElementById(`${inputId}-count`);
    if (el && counter) counter.textContent = `${el.value.length}/${el.maxLength}`;
}

// Non-standard rows get reindexed (ids change on row removal), so locate the
// counter as a sibling via class instead of by id.
function updateNsCharCount(el) {
    if (!el) return;
    const counter = el.parentElement.querySelector('.ns-char-count');
    if (counter) counter.textContent = `${el.value.length}/${el.maxLength}`;
}

// Markup for one non-standard Platform / Key Spec row, with a visible char counter.
function nsRowHtml(id, placeholder, value, onCounter, onPreview) {
    const v = value || '';
    return `<div class="ns-row flex items-center gap-2">
        <div class="relative flex-1">
            <input id="${id}" type="text" maxlength="${HW_KEY_SPEC_MAX_CHARS}" class="input-field pr-14 w-full" value="${esc(v)}" placeholder="${placeholder}" oninput="updateNsCharCount(this);${onCounter};${onPreview}">
            <span class="ns-char-count absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#86868b]">${v.length}/${HW_KEY_SPEC_MAX_CHARS}</span>
        </div>
        <button type="button" class="btn-ghost" style="padding:4px 6px;flex-shrink:0" onclick="this.closest('.ns-row').remove();reindexNsRows('${id.replace(/-\d+$/, '')}');${onCounter};${onPreview}"><i class="ph ph-x" style="font-size:12px"></i></button>
    </div>`;
}

function getProductInitials(name) {
    const text = String(name || '').trim();
    if (!text) return 'OE';
    return text.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function renderSortableProductImage(img, index, context) {
    const removeHandler = context === 'edit' ? `removeEditSwImage(${index})` : `removeSoftwareImage(${index})`;
    return `<div class="product-image-sort-item is-sortable" draggable="true" title="Drag to reorder"
        ondragstart="onProductImageDragStart(event,'${context}',${index})"
        ondragover="onProductImageDragOver(event)"
        ondragleave="onProductImageDragLeave(event)"
        ondrop="onProductImageDrop(event,'${context}',${index})"
        ondragend="onProductImageDragEnd(event)">
        <i class="ph ph-dots-six-vertical product-image-sort-grip" aria-hidden="true"></i>
        <img class="product-image-sort-thumb" src="${esc(img.url)}" alt="" draggable="false">
        <span class="product-image-sort-name">${esc(img.name)}</span>
        ${index === 0 ? '<span class="product-image-primary-badge">Main</span>' : ''}
        <button type="button" class="product-image-sort-remove" aria-label="Remove ${esc(img.name)}" onclick="event.stopPropagation();${removeHandler}">
            <i class="ph ph-trash"></i><span>Remove</span>
        </button>
    </div>`;
}

function renderSingleProductImage(img, removeHandler) {
    return `<div class="product-image-sort-item">
        <img class="product-image-sort-thumb" src="${esc(img.url)}" alt="" draggable="false">
        <span class="product-image-sort-name">${esc(img.name)}</span>
        <button type="button" class="product-image-sort-remove" aria-label="Remove ${esc(img.name)}" onclick="${removeHandler}">
            <i class="ph ph-trash"></i><span>Remove</span>
        </button>
    </div>`;
}

function renderImageStatus(type) {
    const target = document.getElementById(type === 'hardware' ? 'hardware-image-status' : 'software-image-status');
    if (!target) return;
    if (type === 'hardware') {
        const img = createProductState.hardwareImage;
        target.innerHTML = img ? renderSingleProductImage(img, 'removeHardwareImage()') : '';
        return;
    }
    const imgs = createProductState.softwareImages;
    target.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] text-[#86868b] font-bold">${imgs.length}/${PRODUCT_IMAGE_MAX_COUNT} images</span>
            ${imgs.length ? '<button type="button" class="btn-ghost py-1 px-2" onclick="clearSoftwareImages()"><i class="ph ph-trash"></i> Delete all</button>' : ''}
        </div>
        <div class="product-image-sort-list">
            ${imgs.map((img, idx) => renderSortableProductImage(img, idx, 'create')).join('')}
        </div>
        ${imgs.length > 1 ? '<div class="product-image-sort-hint"><i class="ph ph-arrows-out-line-horizontal"></i> Drag images to reorder. The first image is the main image.</div>' : ''}`;
}

function handleHardwareImageUpload(input) {
    const file = input.files?.[0];
    setCreateError('new-p-image', '');
    if (!file) {
        createProductState.hardwareImage = null;
        renderImageStatus('hardware');
        renderCreateProductPreview('hardware');
        return;
    }
    const validation = validateProductImageFiles([file], { required: true });
    if (!validation.valid) {
        input.value = '';
        createProductState.hardwareImage = null;
        setProductImageValidationError('new-p-image', validation);
        renderImageStatus('hardware');
        renderCreateProductPreview('hardware');
        return;
    }
    createProductState.hardwareImage = { file, name: file.name, url: URL.createObjectURL(file) };
    const hwImgObj = createProductState.hardwareImage;
    Store.compressImage(file).then(d => { hwImgObj.dataUrl = d; }).catch(() => {});
    renderImageStatus('hardware');
    renderCreateProductPreview('hardware');
}

function removeHardwareImage() {
    createProductState.hardwareImage = null;
    const input = document.getElementById('new-p-image');
    if (input) input.value = '';
    renderImageStatus('hardware');
    renderCreateProductPreview('hardware');
}

function handleSoftwareIconUpload(input) {
    const file = input.files?.[0];
    setCreateError('new-p-icon', '');
    if (!file) {
        createProductState.softwareIcon = null;
        renderIconStatus();
        renderCreateProductPreview('software');
        return;
    }
    const validation = validateProductImageFiles([file], { required: true });
    if (!validation.valid) {
        input.value = '';
        createProductState.softwareIcon = null;
        setProductImageValidationError('new-p-icon', validation);
        renderIconStatus();
        renderCreateProductPreview('software');
        return;
    }
    openProductIconCropper(file, 'create', 'new-p-icon');
}

function removeSoftwareIcon() {
    createProductState.softwareIcon = null;
    const input = document.getElementById('new-p-icon');
    if (input) input.value = '';
    renderIconStatus();
    renderCreateProductPreview('software');
}

function renderIconStatus() {
    const target = document.getElementById('software-icon-status');
    if (!target) return;
    const icon = createProductState.softwareIcon;
    target.innerHTML = icon ? renderSingleProductImage(icon, 'removeSoftwareIcon()') : '';
}

function handleSoftwareImageUpload(input) {
    const files = Array.from(input.files || []);
    setCreateError('new-p-images', '');
    if (!files.length) return;
    const validation = validateProductImageFiles(files, {
        currentCount: createProductState.softwareImages.length,
        maxCount: PRODUCT_IMAGE_MAX_COUNT,
    });
    if (!validation.valid) {
        input.value = '';
        setProductImageValidationError('new-p-images', validation);
        return;
    }
    createProductState.softwareImages.push(...files.map(file => {
        const obj = { file, name: file.name, url: URL.createObjectURL(file) };
        Store.compressImage(file).then(d => { obj.dataUrl = d; }).catch(() => {});
        return obj;
    }));
    input.value = '';
    renderImageStatus('software');
    renderCreateProductPreview('software');
}

function removeSoftwareImage(index) {
    createProductState.softwareImages.splice(index, 1);
    renderImageStatus('software');
    renderCreateProductPreview('software');
}

function clearSoftwareImages() {
    createProductState.softwareImages = [];
    renderImageStatus('software');
    renderCreateProductPreview('software');
}

let productImageDragContext = null;
let productImageDragIndex = null;

function onProductImageDragStart(e, context, index) {
    productImageDragContext = context;
    productImageDragIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', `${context}:${index}`); } catch (err) { /* ignore */ }
    e.currentTarget.classList.add('is-dragging');
}

function onProductImageDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onProductImageDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onProductImageDragEnd(e) {
    e.currentTarget.classList.remove('is-dragging');
    document.querySelectorAll('.product-image-sort-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    productImageDragContext = null;
    productImageDragIndex = null;
}

function onProductImageDrop(e, context, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const fromIndex = productImageDragIndex;
    if (productImageDragContext !== context || fromIndex === null || fromIndex === targetIndex) return;

    const images = context === 'edit' ? editSwImages : createProductState.softwareImages;
    if (fromIndex < 0 || fromIndex >= images.length || targetIndex < 0 || targetIndex >= images.length) return;
    const [moved] = images.splice(fromIndex, 1);
    images.splice(targetIndex, 0, moved);
    productImageDragContext = null;
    productImageDragIndex = null;
    previewGalleryIndex = 0;

    if (context === 'edit') {
        renderEditSwImageStatus();
        renderEditPreview('software');
    } else {
        renderImageStatus('software');
        renderCreateProductPreview('software');
    }
}

const HW_NS_MAX_ITEMS = 8; // Platform + Key Specs combined max

function getHwFormat() {
    return document.querySelector('input[name="hw-format"]:checked')?.value || 'standard';
}

function clearCreateProductValidation() {
    const form = document.getElementById('create-product-form');
    if (!form) return;
    form.querySelectorAll('.field-error-text').forEach(error => { error.textContent = ''; });
    form.querySelectorAll('.field-error').forEach(field => field.classList.remove('field-error'));
}

function switchHwFormat(fmt) {
    clearCreateProductValidation();
    document.querySelectorAll('#hw-format-selector label').forEach(l => l.classList.remove('is-active'));
    const radio = document.getElementById('hw-format-' + fmt);
    if (radio) { radio.checked = true; radio.nextElementSibling?.classList.add('is-active'); }
    const stdSection = document.getElementById('hw-standard-section');
    const nsSection = document.getElementById('hw-nonstandard-section');
    const vendorBlock = document.getElementById('new-p-vendor-block');
    if (fmt === 'nonstandard') {
        if (stdSection) stdSection.style.display = 'none';
        if (nsSection) nsSection.style.display = '';
        if (vendorBlock) vendorBlock.style.display = 'none';
    } else {
        if (stdSection) stdSection.style.display = '';
        if (nsSection) nsSection.style.display = 'none';
        if (vendorBlock) vendorBlock.style.display = '';
    }
    renderHardwareCreatePreview();
}

function getNsItemCount(prefix) {
    let count = 0;
    for (let i = 0; i < HW_NS_MAX_ITEMS; i++) {
        const el = document.getElementById(`${prefix}-${i}`);
        if (el && el.value.trim()) count++;
    }
    return count;
}

function updateNsCounter() {
    const pCount = getNsItemCount('new-p-platform');
    const sCount = getNsItemCount('new-p-nsspec');
    const total = pCount + sCount;
    const el = document.getElementById('ns-item-counter');
    if (el) {
        el.textContent = `${total} / ${HW_NS_MAX_ITEMS} items used`;
        el.style.color = total >= HW_NS_MAX_ITEMS ? '#ff3b30' : '#86868b';
    }
}

function addNsRow(section) {
    const prefix = section === 'platform' ? 'new-p-platform' : 'new-p-nsspec';
    const container = document.getElementById(prefix + '-list');
    if (!container) return;
    const totalRows = (document.getElementById('new-p-platform-list')?.querySelectorAll('.ns-row').length || 0)
                    + (document.getElementById('new-p-nsspec-list')?.querySelectorAll('.ns-row').length || 0);
    if (totalRows >= HW_NS_MAX_ITEMS) { showToast(`Combined max ${HW_NS_MAX_ITEMS} items reached`, 'error'); return; }
    const existing = container.querySelectorAll('.ns-row').length;
    const idx = existing;
    const ph = section === 'platform' ? 'NVIDIA RTX A6000' : 'Max. GPU x8';
    const tmp = document.createElement('div');
    tmp.innerHTML = nsRowHtml(`${prefix}-${idx}`, `e.g. ${ph}`, '', 'updateNsCounter()', 'renderHardwareCreatePreview()');
    container.appendChild(tmp.firstElementChild);
    updateNsCounter();
}

function reindexNsRows(prefix) {
    const container = document.getElementById(prefix + '-list');
    if (!container) return;
    container.querySelectorAll('.ns-row input').forEach((inp, i) => { inp.id = `${prefix}-${i}`; });
}

function collectNsItems(prefix) {
    const items = [];
    for (let i = 0; i < HW_NS_MAX_ITEMS; i++) {
        const el = document.getElementById(`${prefix}-${i}`);
        if (el && el.value.trim()) items.push(el.value.trim());
    }
    return items;
}

/* ── Edit modal non-standard helpers ── */
function addEditNsRow(section) {
    const prefix = section === 'platform' ? 'edit-p-platform' : 'edit-p-nsspec';
    const container = document.getElementById(prefix + '-list');
    if (!container) return;
    const totalRows = (document.getElementById('edit-p-platform-list')?.querySelectorAll('.ns-row').length || 0)
                    + (document.getElementById('edit-p-nsspec-list')?.querySelectorAll('.ns-row').length || 0);
    if (totalRows >= HW_NS_MAX_ITEMS) { showToast(`Combined max ${HW_NS_MAX_ITEMS} items reached`, 'error'); return; }
    const existing = container.querySelectorAll('.ns-row').length;
    const idx = existing;
    const ph = section === 'platform' ? 'NVIDIA RTX A6000' : 'Max. GPU x8';
    const tmp = document.createElement('div');
    tmp.innerHTML = nsRowHtml(`${prefix}-${idx}`, `e.g. ${ph}`, '', 'updateEditNsCounter()', "renderEditPreview('hardware')");
    container.appendChild(tmp.firstElementChild);
    updateEditNsCounter();
}

function updateEditNsCounter() {
    const pCount = getNsItemCount('edit-p-platform');
    const sCount = getNsItemCount('edit-p-nsspec');
    const total = pCount + sCount;
    const el = document.getElementById('edit-ns-item-counter');
    if (el) {
        el.textContent = `${total} / ${HW_NS_MAX_ITEMS} items used`;
        el.style.color = total >= HW_NS_MAX_ITEMS ? '#ff3b30' : '#86868b';
    }
}

/* ── Edit modal standard Key Specs (Add-button list, single list) ── */
function updateEditSpecCounter() {
    const count = document.getElementById('edit-p-spec-list')?.querySelectorAll('.ns-row').length || 0;
    const el = document.getElementById('edit-spec-item-counter');
    if (el) {
        el.textContent = `${count} / ${HW_KEY_SPEC_MAX_ITEMS} items used`;
        el.style.color = count >= HW_KEY_SPEC_MAX_ITEMS ? '#ff3b30' : '#86868b';
    }
}

function addEditSpecRow() {
    const container = document.getElementById('edit-p-spec-list');
    if (!container) return;
    const existing = container.querySelectorAll('.ns-row').length;
    if (existing >= HW_KEY_SPEC_MAX_ITEMS) { showToast('Max 8 items reached', 'error'); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = nsRowHtml(`edit-p-spec-${existing}`, 'e.g. Intel Xeon 6730P 32 Core', '', 'updateEditSpecCounter()', "renderEditPreview('hardware')");
    container.appendChild(tmp.firstElementChild);
    updateEditSpecCounter();
}

function renderHardwareCreatePreview() {
    const fmt = getHwFormat();
    const name = valueOf('new-p-name') || 'Product Name';
    const category = valueOf('new-p-product-type');
    const isAidaptiv = document.getElementById('new-p-aidaptiv')?.checked || false;
    const image = createProductState.hardwareImage;
    const target = document.getElementById('create-live-preview');
    if (!target) return;

    if (fmt === 'nonstandard') {
        const platforms = collectNsItems('new-p-platform');
        const nsSpecs = collectNsItems('new-p-nsspec');
        target.innerHTML = `
            <div class="preview-eyebrow"><span class="preview-eyebrow-left"><i class="ph ph-eye"></i> Live Preview</span><span class="format-badge is-nonstandard"><i class="ph ph-cube"></i> Non-standard</span></div>
            <div class="hw-preview-card">
                <div class="hw-preview-media">
                    ${image ? `<img src="${esc(image.url)}" alt="${esc(image.name)}">` : `<div class="hw-placeholder-icon" aria-hidden="true">
                        <div class="hw-placeholder-device"></div>
                        <div class="hw-placeholder-device"></div>
                        <div style="margin-top:10px;font-size:0.82rem;font-weight:500;color:#9aa6bf">Upload a product image</div>
                    </div>`}
                </div>
                <div class="hw-preview-body">
                    <h4 class="hw-preview-title">${esc(name)}</h4>
                    <div class="hw-preview-category">${esc(category || 'Product Type')}</div>
                    <hr class="hw-preview-divider">
                    ${platforms.length ? `<div class="preview-section">
                        <div class="preview-section-title"><i class="ph ph-cpu" style="color:#7c8ec8"></i> Processor / Platform</div>
                        <ul class="hw-spec-list">${platforms.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul>
                    </div>` : ''}
                    ${nsSpecs.length ? `<div class="preview-section">
                        <div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div>
                        <ul class="hw-spec-list">${nsSpecs.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul>
                    </div>` : ''}
                    ${!platforms.length && !nsSpecs.length ? '<div style="padding:10px 14px;color:#6d7695;font-size:0.82rem;font-style:italic">Add platform or spec items...</div>' : ''}
                    ${isAidaptiv ? `<div class="hw-aidaptiv-row">
                        <img src="images/logo-aidaptiv-plus.png" alt="aiDAPTIV" class="hw-aidaptiv-logo" onerror="this.outerHTML='<span style=&quot;font-size:1rem;font-weight:900;color:#1d1d1f&quot;>aiDAPTIV</span>'">
                        <span class="hw-aidaptiv-link">What is aiDaptiv?</span>
                    </div>` : ''}
                    <button type="button" class="hw-preview-cta">Select Hardware</button>
                </div>
            </div>
            <div style="margin-top:10px;text-align:center;font-size:0.62rem;color:#86868b;font-style:italic">Non-standard storefront card preview</div>`;
        return;
    }

    // Standard preview: structured spec card
    const specs = collectHardwareSpecs();
    const imagePrompt = name === 'Product Name'
        ? '[ Product image ]'
        : `[ Please place ${name}${category ? ' ' + category : ''} image here ]`;
    target.innerHTML = `
        <div class="preview-eyebrow"><span class="preview-eyebrow-left"><i class="ph ph-eye"></i> Live Preview</span><span class="format-badge is-standard"><i class="ph ph-list-bullets"></i> Standard</span></div>
        <div class="hw-preview-card">
            <div class="hw-preview-media">
                ${image ? `<img src="${esc(image.url)}" alt="${esc(image.name)}">` : `<div class="hw-placeholder-icon" aria-hidden="true">
                    <div class="hw-placeholder-device"></div>
                    <div class="hw-placeholder-device"></div>
                    <div style="margin-top:10px;font-size:0.88rem;font-weight:500;line-height:1.4">${esc(imagePrompt)}</div>
                </div>`}
            </div>
            <div class="hw-preview-body">
                <h4 class="hw-preview-title">${esc(name)}</h4>
                <div class="hw-preview-category">${esc(category || 'Product Type')}</div>
                <hr class="hw-preview-divider">
                <div class="preview-section">
                    <div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div>
                    ${specs.length ? `<ul class="hw-spec-list">${specs.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ul>` : '<div style="padding:10px 14px 12px;color:#6d7695;font-size:0.82rem;font-style:italic">Fill in key specifications...</div>'}
                </div>
                ${isAidaptiv ? `<div class="hw-aidaptiv-row">
                    <img src="images/logo-aidaptiv-plus.png" alt="aiDAPTIV" class="hw-aidaptiv-logo" onerror="this.outerHTML='<span style=&quot;font-size:1rem;font-weight:900;color:#1d1d1f&quot;>aiDAPTIV</span>'">
                    <span class="hw-aidaptiv-link">What is aiDaptiv?</span>
                </div>` : ''}
                <button type="button" class="hw-preview-cta">Select Hardware</button>
            </div>
        </div>
        <div style="margin-top:10px;text-align:center;font-size:0.62rem;color:#86868b;font-style:italic">Standard storefront card preview</div>`;
}

let previewGalleryIndex = 0;

function renderPreviewGallery(images, context = 'create') {
    if (!images || images.length === 0) {
        return `<div class="sd-gallery"><div class="sd-gallery-placeholder"><i class="ph ph-image" style="font-size:2.2rem;opacity:0.45"></i></div>
            <span class="sd-gallery-nav prev"><i class="ph ph-caret-left"></i></span>
            <span class="sd-gallery-nav next"><i class="ph ph-caret-right"></i></span></div>`;
    }
    if (previewGalleryIndex >= images.length) previewGalleryIndex = 0;
    const img = images[previewGalleryIndex];
    const dots = images.length > 1
        ? `<div class="sd-gallery-dots">${images.map((_, i) => `<span class="sd-gallery-dot${i === previewGalleryIndex ? ' active' : ''}"></span>`).join('')}</div>`
        : '';
    return `<div>
        <div class="sd-gallery">
            <img class="sd-gallery-img" src="${esc(img.url)}" alt="${esc(img.name)}">
            ${images.length > 1 ? `<span class="sd-gallery-nav prev" onclick="slidePreviewGallery(-1,'${context}')"><i class="ph ph-caret-left"></i></span>
            <span class="sd-gallery-nav next" onclick="slidePreviewGallery(1,'${context}')"><i class="ph ph-caret-right"></i></span>` : ''}
        </div>${dots}</div>`;
}

function slidePreviewGallery(dir, context = 'create') {
    const total = context === 'edit' ? editSwImages.length : createProductState.softwareImages.length;
    if (total <= 1) return;
    previewGalleryIndex = (previewGalleryIndex + dir + total) % total;
    if (context === 'edit') renderEditPreview('software');
    else renderSoftwareCreatePreview();
}

function renderSoftwareCreatePreview() {
    const name = valueOf('new-p-name');
    const vendor = valueOf('new-p-vendor');
    const pitch = valueOf('new-p-pitch');
    const siteUrl = valueOf('new-p-url');
    const features = collectSoftwareFeatures();
    const industries = getCheckedValues('new-p-industries');
    const images = createProductState.softwareImages;
    const icon = createProductState.softwareIcon;
    const initials = name ? getProductInitials(name) : '';
    const target = document.getElementById('create-live-preview');
    if (!target) return;

    const SVG_FEATURES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const SVG_INDUSTRIES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
    const PLACEHOLDER_STYLE = 'color:#9aa6bf';

    const featuresHtml = features.length
        ? `<ul class="sd-feature-list">${features.map(f => `<li class="sd-feature-item"><span class="sd-feature-dot"></span><span>${esc(f)}</span></li>`).join('')}</ul>`
        : `<div style="padding:12px 14px;${PLACEHOLDER_STYLE};font-size:0.82rem">Add up to 5 key features...</div>`;

    const industriesHtml = industries.length
        ? `<div class="sd-industry-list">${industries.map(i => `<span class="sd-industry-chip">${esc(i)}</span>`).join('')}</div>`
        : `<div style="padding:12px 14px;${PLACEHOLDER_STYLE};font-size:0.82rem">Select applicable industries...</div>`;

    const markContent = icon
        ? `<img src="${esc(icon.url)}" alt="${esc(icon.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:20px">`
        : initials
            ? esc(initials)
            : '<i class="ph ph-package" style="font-size:1.4rem;opacity:0.5"></i>';

    target.innerHTML = `
        <div class="sw-preview-eyebrow"><i class="ph ph-eye" style="font-size:0.8rem"></i> Live Preview</div>
        <div class="software-live-preview">
            <div class="sd-hero" style="position:relative;padding-top:28px">
                <div class="sd-hero-header">
                    <div class="sd-mark">${markContent}</div>
                    <div style="min-width:0;flex:1">
                        <p class="sd-company">${vendor ? esc(vendor) : `<span style="${PLACEHOLDER_STYLE}">Company Name</span>`}</p>
                        <h2 class="sd-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name ? esc(name) : `<span style="${PLACEHOLDER_STYLE};font-weight:500">Product Name</span>`}</h2>
                        ${renderSwLicenseBadge(getSelectedLicense('new-p-license'))}
                    </div>
                </div>
                <p class="sd-tagline">${pitch ? esc(pitch) : `<span style="${PLACEHOLDER_STYLE}">Short product description...</span>`}</p>
            </div>
            <div class="sd-content">
                <section class="sd-meta-block">
                    <div class="sd-meta-title">${SVG_FEATURES} Key Features</div>
                    ${featuresHtml}
                </section>
                ${renderPreviewGallery(images)}
                <section class="sd-meta-block">
                    <div class="sd-meta-title">${SVG_INDUSTRIES} Applicable Industries</div>
                    ${industriesHtml}
                </section>
            </div>
            <div class="sd-action-footer" style="margin-top:auto">
                <button class="sd-action-primary" type="button">Select</button>
                ${renderSwSiteLink(siteUrl, { placeholder: 'Official website link...' })}
            </div>
        </div>`;
}

function renderCreateProductPreview(type) {
    if (type === 'software') renderSoftwareCreatePreview();
    else renderHardwareCreatePreview();
}

function setupCreateProductBindings(type) {
    const form = document.getElementById('create-product-form');
    if (!form) return;
    const rerender = () => renderCreateProductPreview(type);
    form.querySelectorAll('input, textarea, select').forEach(el => {
        // File inputs have dedicated upload handlers that own validation and
        // preview updates. A generic change listener would immediately clear
        // an upload error raised by those handlers during the same event.
        if (el.type === 'file') return;
        el.addEventListener('input', () => {
            setCreateError(el.id, '');
            if (type === 'software') clearSoftwareGroupError(el, SW_REQUIRED_IDS.create);
            if (el.id.startsWith('new-p-feature-')) {
                const idx = el.id.replace('new-p-feature-', '');
                const cnt = document.getElementById(`new-p-feature-${idx}-count`);
                if (cnt) cnt.textContent = `${el.value.length}/${SOFTWARE_FEATURE_MAX_CHARS}`;
            }
            rerender();
        });
        el.addEventListener('change', () => {
            setCreateError(el.id, '');
            if (type === 'software') clearSoftwareGroupError(el, SW_REQUIRED_IDS.create);
            rerender();
        });
    });
    renderImageStatus(type);
    if (type === 'hardware') updateSpecCounter();
    rerender();
}

// The create and edit forms name their inputs differently, so the shared rules
// take an id map. Every rule runs — the caller shows all offending fields at
// once instead of one per submit.
const SW_REQUIRED_IDS = {
    create: {
        url: 'new-p-url', icon: 'new-p-icon', pitch: 'new-p-pitch',
        categories: 'new-p-categories',
        features: 'new-p-features', featurePrefix: 'new-p-feature-',
        industries: 'new-p-industries', license: 'new-p-license',
    },
    edit: {
        url: 'edit-p-url', icon: 'edit-p-icon', pitch: 'edit-p-tagline',
        categories: 'edit-p-categories',
        features: 'edit-p-features', featurePrefix: 'edit-p-feat-',
        industries: 'edit-p-industries', license: 'edit-p-license',
    },
};

const SW_FEATURE_MIN_ITEMS = 3;

function countSoftwareFeatures(ids) {
    return Array.from({ length: SOFTWARE_FEATURE_MAX_ITEMS }, (_, i) => valueOf(`${ids.featurePrefix}${i}`)).filter(Boolean).length;
}

// Key Features and Applicable Industries report on a group-level container, so
// clearing by the edited element's own id would leave the message stuck.
function clearSoftwareGroupError(el, ids) {
    if (el.id && el.id.startsWith(ids.featurePrefix)) setCreateError(ids.features, '');
    if (el.closest(`#${ids.industries}`)) setCreateError(ids.industries, '');
}

// Shared required-field rules for software, applied identically on create and
// edit. `hasIcon` differs per form: a freshly picked file on create, an
// existing or newly picked one on edit.
function validateSoftwareRequiredFields(ids, { hasIcon }) {
    let ok = true;

    setCreateError(ids.icon, hasIcon ? '' : 'Please upload a Product Icon.');
    if (!hasIcon) ok = false;

    ok = validateRequiredField(ids.pitch, 'Please enter a Short Pitch.') && ok;

    if (!getCheckedValues(ids.categories).length) {
        setCreateError(ids.categories, 'Please select Category.');
        ok = false;
    } else {
        setCreateError(ids.categories, '');
    }

    const featureCount = countSoftwareFeatures(ids);
    if (featureCount < SW_FEATURE_MIN_ITEMS) {
        setCreateError(ids.features, `At least ${SW_FEATURE_MIN_ITEMS} Key Features are required.`);
        ok = false;
    } else {
        setCreateError(ids.features, '');
    }

    if (!getCheckedValues(ids.industries).length) {
        setCreateError(ids.industries, 'Please select at least one Applicable Industry.');
        ok = false;
    } else {
        setCreateError(ids.industries, '');
    }

    ok = validateSwLicenseSelection(ids.license) && ok;

    // Optional field: only a filled-in value has to look like a URL.
    if (isValidProductUrl(valueOf(ids.url))) {
        setCreateError(ids.url, '');
    } else {
        setCreateError(ids.url, 'Please enter a valid URL, e.g. https://www.example.com');
        ok = false;
    }

    return ok;
}

function validateRequiredField(id, message = 'This field is required.') {
    const ok = !!valueOf(id);
    setCreateError(id, ok ? '' : message);
    return ok;
}

function validateCreateProductForm(type) {
    let ok = true;
    ok = validateRequiredField('new-p-name', 'Please enter Product Name.') && ok;
    if (!(type === 'hardware' && getHwFormat() === 'nonstandard')) {
        ok = validateRequiredField('new-p-vendor', 'Please enter Vendor.') && ok;
    }
    if (type === 'hardware') {
        const fmt = getHwFormat();
        ok = validateRequiredField('new-p-product-type', 'Please select Product Type.') && ok;
        if (fmt === 'standard') {
            ok = validateRequiredField('new-p-brand', 'Please enter Brand.') && ok;
            ok = validateRequiredField('new-p-model', 'Please enter Model.') && ok;
            const specs = collectHardwareSpecs();
            if (specs.length < HW_KEY_SPEC_MIN_ITEMS) {
                setCreateError('new-p-specs', `At least ${HW_KEY_SPEC_MIN_ITEMS} Key Specifications are required.`);
                ok = false;
            } else {
                setCreateError('new-p-specs', '');
            }
        } else {
            // Non-standard: at least HW_KEY_SPEC_MIN_ITEMS items combined across platform + specs
            const platforms = collectNsItems('new-p-platform');
            const nsSpecs = collectNsItems('new-p-nsspec');
            if (platforms.length + nsSpecs.length < HW_KEY_SPEC_MIN_ITEMS) {
                setCreateError('new-p-ns', `At least ${HW_KEY_SPEC_MIN_ITEMS} items across Processor/Platform and Key Specifications are required.`);
                ok = false;
            } else {
                setCreateError('new-p-ns', '');
            }
        }
        const imageValidation = validateProductImageFiles(
            createProductState.hardwareImage ? [createProductState.hardwareImage.file] : [],
            { required: true },
        );
        if (!imageValidation.valid) {
            setCreateError('new-p-image', imageValidation.message);
            ok = false;
        }
    } else {
        ok = validateSoftwareRequiredFields(SW_REQUIRED_IDS.create, {
            hasIcon: !!createProductState.softwareIcon,
        }) && ok;
    }
    return ok;
}

function showCreateProductModal(type) {
    const isSW = type === 'software';
    createProductState = { type, hardwareImage: null, softwareIcon: null, softwareImages: [] };
    const title = isSW ? 'Create Software Product Draft' : 'Create Hardware Product Draft';
    const hardwareOptions = HARDWARE_PRODUCT_TYPES
        .filter(item => item.is_active)
        .map(item => `<option value="${esc(item.label)}">${esc(item.label)}</option>`)
        .join('');
    const hardwareFields = `
        ${createFormSection('ph-layout', 'Product Format', 'Choose the storefront display format. This cannot be changed after creation.', `
            <div class="format-selector" id="hw-format-selector">
                <input type="radio" name="hw-format" id="hw-format-standard" value="standard" checked>
                <label for="hw-format-standard" class="is-active" onclick="switchHwFormat('standard')"><i class="ph ph-list-bullets"></i> Standard</label>
                <input type="radio" name="hw-format" id="hw-format-nonstandard" value="nonstandard">
                <label for="hw-format-nonstandard" onclick="switchHwFormat('nonstandard')"><i class="ph ph-cube"></i> Non-standard</label>
            </div>
            <div class="field-hint" style="margin-top:8px"><i class="ph ph-warning-circle"></i> Format is permanent and cannot be changed after creation.</div>
        `)}
        ${createFormSection('ph-identification-card', 'Basic Info', 'Core product identity and catalog classification.', `
        ${createField('new-p-name', 'Product Name', { required: true, maxlength: 100, placeholder: 'e.g. Brand + Model or custom display name' })}
        <div class="form-grid-two">
            <div id="new-p-vendor-block" class="min-w-0">${createField('new-p-vendor', 'Vendor', { required: true, maxlength: 100, placeholder: 'e.g. Phison Electronics' })}</div>
            <div>
                <label for="new-p-product-type" class="field-label">Product Type <span class="req">*</span></label>
                <select id="new-p-product-type" class="input-field" required>
                    <option value="">Please select</option>
                    ${hardwareOptions}
                </select>
                <div id="new-p-product-type-error" class="field-error-text"></div>
            </div>
        </div>`)}

        <!-- ── Standard-only fields ── -->
        <div id="hw-standard-section">
        ${createFormSection('ph-identification-card', 'Model Details', 'Brand and model number for standard products.', `
            <div class="form-grid-two">
                ${createField('new-p-brand', 'Brand', { required: true, maxlength: 50, placeholder: 'e.g. GIGABYTE' })}
                ${createField('new-p-model', 'Model', { required: true, maxlength: 50, placeholder: 'e.g. W773-80' })}
            </div>`)}
        ${createFormSection('ph-sliders-horizontal', 'Key Specifications', 'The first three populated rows are required for draft creation.', `
        <div>
            <div class="flex items-center justify-between mb-2">
                <div>
                    <div class="field-label" style="margin:0">Key Specifications <span class="text-red-400">*</span></div>
                    <div class="field-hint">Min ${HW_KEY_SPEC_MIN_ITEMS} required · Max ${HW_KEY_SPEC_MAX_ITEMS} · ${HW_KEY_SPEC_MAX_CHARS} chars each</div>
                </div>
                <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addSpecRow()"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
            </div>
            <div id="new-p-spec-list" class="space-y-2">
                ${Array.from({ length: HW_KEY_SPEC_MIN_ITEMS }, (_, i) => nsRowHtml('new-p-spec-' + i, 'e.g. Intel Xeon 6730P 32 Core', '', 'updateSpecCounter()', 'renderHardwareCreatePreview()')).join('')}
            </div>
            <div id="spec-item-counter" style="margin-top:8px;font-size:11px;font-weight:600;color:#86868b">0 / ${HW_KEY_SPEC_MAX_ITEMS} items used</div>
            <div id="new-p-specs-error" class="field-error-text"></div>
        </div>`)}
        </div>

        <!-- ── Non-standard fields ── -->
        <div id="hw-nonstandard-section" style="display:none">
        ${createFormSection('ph-cpu', 'Processor / Platform', 'Supported processors and platforms for this product.', `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <div class="field-label" style="margin:0">Processor / Platform</div>
                    <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addNsRow('platform')"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
                </div>
                <div class="field-hint" style="margin-bottom:8px">Processor / Platform and Key Specifications share a combined max of ${HW_NS_MAX_ITEMS} (min ${HW_KEY_SPEC_MIN_ITEMS}).</div>
                <div id="new-p-platform-list" class="space-y-2">
                    ${nsRowHtml('new-p-platform-0', 'e.g. NVIDIA RTX A6000', '', 'updateNsCounter()', 'renderHardwareCreatePreview()')}
                </div>
            </div>`)}
        ${createFormSection('ph-sliders-horizontal', 'Key Specifications', 'Technical specifications for this product.', `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <div class="field-label" style="margin:0">Key Specifications</div>
                    <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addNsRow('spec')"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
                </div>
                <div class="field-hint" style="margin-bottom:8px">Processor / Platform and Key Specifications share a combined max of ${HW_NS_MAX_ITEMS} (min ${HW_KEY_SPEC_MIN_ITEMS}).</div>
                <div id="new-p-nsspec-list" class="space-y-2">
                    ${nsRowHtml('new-p-nsspec-0', 'e.g. Max. GPU x8', '', 'updateNsCounter()', 'renderHardwareCreatePreview()')}
                </div>
                <div id="ns-item-counter" style="margin-top:8px;font-size:11px;font-weight:600;color:#86868b">0 / ${HW_NS_MAX_ITEMS} items used</div>
                <div id="new-p-ns-error" class="field-error-text"></div>
            </div>`)}
        </div>

        ${createFormSection('ph-image', 'Product Image', 'Single storefront image. New uploads replace the previous image.', `
        <div>
            <label class="field-label">Product Image <span class="req">*</span></label>
            <label class="file-upload-wrap">
                <input id="new-p-image" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onchange="handleHardwareImageUpload(this)">
                <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose File</span>
                <span class="file-upload-text">Max 5MB · JPG / JPEG / PNG</span>
            </label>
            <div id="new-p-image-error" class="field-error-text"></div>
            <div id="hardware-image-status" class="mt-2"></div>
        </div>`)}
        ${createFormSection('ph-sparkle', 'Frontend Display', 'Optional storefront badge and link treatment.', `
            <label class="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" id="new-p-aidaptiv" class="w-4 h-4 rounded border-[#e8eaed] accent-aiso">
                <div>
                    <div class="text-sm font-semibold text-[#1d1d1f]">aiDAPTIV</div>
                    <div class="text-[11px] text-[#86868b]">Display aiDAPTIV logo, badge, and link on the frontend preview</div>
                </div>
            </label>
        `)}`;

    const softwareFields = `
        ${createFormSection('ph-identification-card', 'Basic Info', 'Product identity shown in lists and storefront preview.', `
        ${createField('new-p-name', 'Product Name', { required: true, maxlength: 100, placeholder: 'e.g. OrientAI Express' })}
        ${createField('new-p-vendor', 'Vendor', { required: true, maxlength: 100, placeholder: 'e.g. TPIsoftware Corporation' })}
        ${createField('new-p-url', 'Official Website', { type: 'url', maxlength: SW_URL_MAX_CHARS, placeholder: 'e.g. https://www.tpisoftware.com', hint: 'Optional. Shown as a link on the storefront preview.' })}
        <div>
            <label class="field-label">Product Icon <span class="req">*</span></label>
            <label class="file-upload-wrap">
                <input id="new-p-icon" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onchange="handleSoftwareIconUpload(this)">
                <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose File</span>
                <span class="file-upload-text">Square crop · Max 5MB · JPG / JPEG / PNG</span>
            </label>
            <div id="new-p-icon-error" class="field-error-text"></div>
            <div id="software-icon-status" class="mt-2"></div>
        </div>
        `)}
        ${createFormSection('ph-chat-centered-text', 'Positioning', 'Customer-facing copy, category, and feature bullets.', `
        ${createTextArea('new-p-pitch', 'Short Pitch', { required: true, maxlength: 300, rows: 2, placeholder: 'One-line pitch...' })}
        <div>
            <div class="field-label mb-3">Category <span class="req">*</span> <span class="text-[10px] text-[#86868b] font-bold" style="margin-left:4px">Max ${SW_CATEGORY_MAX}</span></div>
            ${renderSwCategoryChecks('new-p-categories')}
        </div>
        <div>
            <div class="flex items-center justify-between mb-3">
                <div class="field-label">Key Features <span class="req">*</span></div>
                <span class="text-[10px] text-[#86868b] font-bold">Min ${SW_FEATURE_MIN_ITEMS} · Max ${SOFTWARE_FEATURE_MAX_ITEMS} · 150 chars each</span>
            </div>
            <div class="space-y-2">${renderSoftwareFeatureInputs()}</div>
            <div id="new-p-features-error" class="field-error-text"></div>
        </div>
        <div>
            <div class="field-label mb-3">Applicable Industries <span class="req">*</span></div>
            <div id="new-p-industries" class="flex flex-wrap gap-2">
                ${SOFTWARE_INDUSTRY_OPTIONS.filter(o => o.is_active).map(o => `<label class="preview-pill cursor-pointer"><input type="checkbox" value="${esc(o.label)}" class="mr-2 accent-aiso">${esc(o.label)}</label>`).join('')}
            </div>
            <div id="new-p-industries-error" class="field-error-text"></div>
        </div>`)}
        ${createFormSection('ph-certificate', 'Licensing', 'Licensing offer shown as a badge next to the product name.', `
            <div class="field-label mb-3">Licensing Options <span class="req">*</span></div>
            ${renderSwLicenseRadios('new-p-license')}
        `)}
        ${createFormSection('ph-images', 'Product Images', 'Upload up to five images for the storefront preview.', `
            <label class="field-label">Product Images</label>
            <label class="file-upload-wrap">
                <input id="new-p-images" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple onchange="handleSoftwareImageUpload(this)">
                <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose Files</span>
                <span class="file-upload-text">Max ${PRODUCT_IMAGE_MAX_COUNT} images · 5MB each · JPG / JPEG / PNG</span>
            </label>
            <div id="new-p-images-error" class="field-error-text"></div>
            <div id="software-image-status" class="mt-2"></div>
        `)}`;

    showModal(`
        <div class="create-modal-shell">
            <div class="create-modal-header">
                <div class="create-modal-title-row">
                    <div class="create-modal-icon"><i class="ph ${isSW ? 'ph-app-window' : 'ph-hard-drives'}"></i></div>
                    <div class="min-w-0">
                        <div class="create-modal-kicker">${isSW ? 'Software Product' : 'Hardware Product'}</div>
                        <h3 class="text-xl font-bold truncate">${title}</h3>
                    </div>
                </div>
                <button onclick="closeModal()" class="create-modal-close" aria-label="Close"><i class="ph ph-x text-xl"></i></button>
            </div>
            <div class="create-modal-grid">
            <div class="create-form-scroll">
                <form id="create-product-form" novalidate>
                    ${isSW ? softwareFields : hardwareFields}
                    <div class="form-actions">
                        <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
                        <button type="submit" class="btn-primary">Create Draft</button>
                    </div>
                </form>
            </div>
            <div id="create-live-preview" class="create-preview-scroll ${isSW ? 'is-software' : 'is-hardware'}"></div>
            </div>
        </div>`, true);

    document.getElementById('create-product-form').addEventListener('submit', event => {
        event.preventDefault();
        createProduct(type);
    });
    setupCreateProductBindings(type);
}

function createProduct(type) {
    if (!validateCreateProductForm(type)) {
        showToast('Please fix the highlighted fields', 'error');
        return;
    }
    const isSW = type === 'software';
    const isNsHw = !isSW && getHwFormat() === 'nonstandard';
    const name = valueOf('new-p-name');
    const vendorName = isNsHw ? '' : valueOf('new-p-vendor');
    const newCategories = isSW ? getCheckedValues('new-p-categories').slice(0, SW_CATEGORY_MAX) : [];
    const today = new Date().toISOString().slice(0, 10);
    const newP = {
        id: `${type.slice(0, 2)}${Date.now() % 100000}`,
        product_type: type,
        vendor_id: isNsHw ? null : getMatchingVendorId(vendorName, type),
        vendor_name: vendorName,
        name,
        brand: isSW ? '' : valueOf('new-p-brand'),
        sub_category: isSW ? (newCategories[0] || '') : valueOf('new-p-product-type'),
        short_description: '',
        status: 'draft',
        display_order: PRODUCTS.filter(p => p.product_type === type).length + 1,
        created_at: today,
        updated_at: today,
    };

    if (isSW) {
        newP.categories = newCategories;
        newP.tagline = valueOf('new-p-pitch');
        newP.sw_category = 'optional';
        newP.features = collectSoftwareFeatures();
        newP.license_offer = getSelectedLicense('new-p-license');
        newP.officialUrl = normalizeProductUrl(valueOf('new-p-url'));
        newP.industries = getCheckedValues('new-p-industries');
        // Compatibility is maintained independently in Parameter Center.
        newP.compatible_hardware = [];
        newP.photos = createProductState.softwareImages.map(img => img.name);
        newP.image_name = createProductState.softwareImages[0]?.name || '';
        newP.icon_name = createProductState.softwareIcon?.name || '';
        newP.photos_data = createProductState.softwareImages.map(img => img.dataUrl).filter(Boolean);
        newP.image_data = createProductState.softwareImages[0]?.dataUrl || '';
        newP.icon_data = createProductState.softwareIcon?.dataUrl || '';
    } else {
        const fmt = getHwFormat();
        newP.product_format = fmt;
        newP.is_aidaptiv = document.getElementById('new-p-aidaptiv')?.checked || false;
        newP.image_name = createProductState.hardwareImage?.name || '';
        newP.photos = createProductState.hardwareImage ? [createProductState.hardwareImage.name] : [];
        newP.image_data = createProductState.hardwareImage?.dataUrl || '';
        newP.photos_data = createProductState.hardwareImage?.dataUrl ? [createProductState.hardwareImage.dataUrl] : [];
        if (fmt === 'standard') {
            newP.model = valueOf('new-p-model');
            newP.key_specifications = collectHardwareSpecs();
            newP.bestFor = [];
        } else {
            newP.model = '';
            newP.ns_platforms = collectNsItems('new-p-platform');
            newP.key_specifications = collectNsItems('new-p-nsspec');
            newP.bestFor = [];
        }
    }

    const saved = commitPortalMutation(() => {
        PRODUCTS.push(newP);
        logActivity('Created', name, 'New draft created');
    });
    if (!saved) return;
    closeModal();
    showToast(`${name} has been created as a draft.`, 'success');
    navigate(isSW ? 'sw-products' : 'hw-products');
}

function showEditProductModal(pid, source) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    if (p.status === 'archived') { showToast('Archived products cannot be edited. Please restore the product as a draft before making changes.', 'error'); return; }
    // Remember where Edit was opened from so saveProduct can return there.
    editReturnView = source === 'list' ? 'list' : 'detail';
    const isSW = p.product_type === 'software';
    const storedSwImages = (p.photos_data?.length ? p.photos_data : (p.image_data ? [p.image_data] : []));
    editSwImages = storedSwImages.map((url, i) => ({
        name: p.photos?.[i] || p.image_name || `Product image ${i + 1}`,
        url,
        dataUrl: url,
        isExisting: true,
    }));
    editSwIcon = p.icon_data ? { name: p.icon_name || 'Product icon', url: p.icon_data, dataUrl: p.icon_data, isExisting: true } : null;
    editHwImage = p.image_data ? { name: p.image_name || p.photos?.[0] || 'Product image', url: p.image_data, dataUrl: p.image_data, isExisting: true } : null;
    editHwFormat = p.product_format || 'standard';
    const activeIndustries = SOFTWARE_INDUSTRY_OPTIONS.filter(o => o.is_active);
    // Keep currently-assigned industries visible even if no longer an active
    // option, so opening Edit and saving never silently drops them.
    const editIndustryLabels = activeIndustries.map(o => o.label);
    (p.industries || []).forEach(v => { if (!editIndustryLabels.includes(v)) editIndustryLabels.push(v); });
    const activeHwTypes = HARDWARE_PRODUCT_TYPES.filter(o => o.is_active);

    const featureInputs = Array.from({ length: SOFTWARE_FEATURE_MAX_ITEMS }, (_, i) => {
        const val = (p.features || [])[i] || '';
        return `<div class="flex items-center gap-2">
            <span class="text-xs text-[#86868b] font-bold w-5 text-center">${i + 1}</span>
            <div class="relative flex-1">
                <input id="edit-p-feat-${i}" type="text" maxlength="${SOFTWARE_FEATURE_MAX_CHARS}" class="input-field pr-14 w-full" value="${esc(val)}" placeholder="${i < 1 ? 'e.g. Core capability...' : 'Optional'}" oninput="updateCharCounter('edit-p-feat-${i}')">
                <span id="edit-p-feat-${i}-count" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#86868b]">${val.length}/${SOFTWARE_FEATURE_MAX_CHARS}</span>
            </div>
        </div>`;
    }).join('');

    const editStdSpecs = (p.product_format || 'standard') === 'standard' ? (p.key_specifications || []) : [];
    const specInputs = (editStdSpecs.length ? editStdSpecs : ['']).map((v, i) =>
        nsRowHtml(`edit-p-spec-${i}`, 'e.g. Intel Xeon 6730P 32 Core', v, 'updateEditSpecCounter()', "renderEditPreview('hardware')")).join('');

    const swFields = `
        ${createFormSection('ph-identification-card', 'Basic Info', 'Core product identity.', `
            ${createField('edit-p-name', 'Product Name', { required: true, maxlength: 100 })}
            ${createField('edit-p-vendor', 'Vendor', { required: true, maxlength: 100 })}
            ${createField('edit-p-url', 'Official Website', { type: 'url', maxlength: SW_URL_MAX_CHARS, placeholder: 'e.g. https://www.tpisoftware.com', hint: 'Optional. Shown as a link on the storefront preview.' })}
        `)}
        ${createFormSection('ph-chat-centered-text', 'Positioning', 'Customer-facing copy, category, and features.', `
            <div>
                <div class="field-label mb-3">Category <span class="req">*</span> <span class="text-[10px] text-[#86868b] font-bold" style="margin-left:4px">Max ${SW_CATEGORY_MAX}</span></div>
                ${renderSwCategoryChecks('edit-p-categories', getSwCategories(p))}
            </div>
            ${createField('edit-p-tagline', 'Short Pitch', { required: true, maxlength: 300 })}
            <div>
                <div class="flex items-center justify-between mb-3">
                    <div class="field-label">Key Features <span class="req">*</span></div>
                    <span class="text-[10px] text-[#86868b] font-bold">Min ${SW_FEATURE_MIN_ITEMS} · Max ${SOFTWARE_FEATURE_MAX_ITEMS} · 150 chars each</span>
                </div>
                <div class="space-y-2">${featureInputs}</div>
                <div id="edit-p-features-error" class="field-error-text"></div>
            </div>
            <div>
                <div class="field-label mb-3">Applicable Industries <span class="req">*</span></div>
                <div id="edit-p-industries" class="flex flex-wrap gap-2">
                    ${editIndustryLabels.map(label => `<label class="preview-pill cursor-pointer"><input type="checkbox" value="${esc(label)}" class="mr-2 accent-aiso" ${(p.industries || []).includes(label) ? 'checked' : ''}>${esc(label)}</label>`).join('')}
                </div>
                <div id="edit-p-industries-error" class="field-error-text"></div>
            </div>
        `)}
        ${createFormSection('ph-certificate', 'Licensing', 'Licensing offer shown as a badge next to the product name.', `
            <div class="field-label mb-3">Licensing Options <span class="req">*</span></div>
            ${renderSwLicenseRadios('edit-p-license', p.license_offer || '', { hasOffer: p.license_offer !== undefined })}
        `)}
        ${createFormSection('ph-images', 'Product Images', 'Upload up to five images for the storefront preview.', `
            <div>
                <label class="field-label">Product Images</label>
                <label class="file-upload-wrap">
                    <input id="edit-p-images" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple onchange="handleEditSwImageUpload(this)">
                    <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose Files</span>
                    <span class="file-upload-text">Max ${PRODUCT_IMAGE_MAX_COUNT} images · 5MB each · JPG / JPEG / PNG</span>
                </label>
                <div id="edit-p-images-error" class="field-error-text"></div>
            </div>
            <div id="edit-p-images-status"></div>
            <div>
                <label class="field-label">Product Icon <span class="req">*</span></label>
                <label class="file-upload-wrap">
                    <input id="edit-p-icon" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onchange="handleEditSwIconUpload(this)">
                    <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose File</span>
                    <span class="file-upload-text">Square crop · Max 5MB · JPG / JPEG / PNG</span>
                </label>
                <div id="edit-p-icon-error" class="field-error-text"></div>
            </div>
            <div id="edit-p-icon-status"></div>
        `)}`;

    const hwFmt = p.product_format || 'standard';
    const isStandardHw = hwFmt === 'standard';
    const fmtBadgeHtml = `<div style="margin-bottom:4px">
        <span class="format-badge ${isStandardHw ? 'is-standard' : 'is-nonstandard'}">
            <i class="ph ${isStandardHw ? 'ph-list-bullets' : 'ph-cube'}"></i>
            ${isStandardHw ? 'Standard' : 'Non-standard'}
        </span>
        <span style="font-size:11px;color:#86868b;margin-left:6px">Format is locked after creation</span>
    </div>`;

    // Build non-standard edit inputs from existing data
    const editNsPlatforms = (p.ns_platforms || []);
    const editNsSpecs = isStandardHw ? [] : (p.key_specifications || []);
    const editNsPlatformRows = (editNsPlatforms.length ? editNsPlatforms : ['']).map((v, i) =>
        nsRowHtml(`edit-p-platform-${i}`, 'e.g. NVIDIA RTX A6000', v, 'updateEditNsCounter()', "renderEditPreview('hardware')")).join('');
    const editNsSpecRows = (editNsSpecs.length ? editNsSpecs : ['']).map((v, i) =>
        nsRowHtml(`edit-p-nsspec-${i}`, 'e.g. Max. GPU x8', v, 'updateEditNsCounter()', "renderEditPreview('hardware')")).join('');

    const hwFields = `
        ${createFormSection('ph-identification-card', 'Basic Info', 'Core product identity and classification.', `
            ${fmtBadgeHtml}
            ${createField('edit-p-name', 'Product Name', { required: true, maxlength: 100 })}
            <div class="form-grid-two">
                ${isStandardHw ? createField('edit-p-vendor', 'Vendor', { required: true, maxlength: 100, wrapClass: 'min-w-0' }) : ''}
                <div>
                    <label for="edit-p-hw-type" class="field-label">Product Type</label>
                    <select id="edit-p-hw-type" class="input-field">
                        ${activeHwTypes.map(o => `<option value="${esc(o.label)}" ${o.label === p.sub_category ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                    </select>
                </div>
            </div>
            ${isStandardHw ? `<div class="form-grid-two">
                ${createField('edit-p-brand', 'Brand', { required: true, maxlength: 50 })}
                ${createField('edit-p-model', 'Model', { required: true, maxlength: 50 })}
            </div>` : ''}
        `)}
        ${isStandardHw ? createFormSection('ph-sliders-horizontal', 'Key Specifications', 'Displayed as bullet points on the storefront card.', `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <div>
                        <div class="field-label" style="margin:0">Key Specifications</div>
                        <div class="field-hint">Min ${HW_KEY_SPEC_MIN_ITEMS} required · Max ${HW_KEY_SPEC_MAX_ITEMS} · ${HW_KEY_SPEC_MAX_CHARS} chars each</div>
                    </div>
                    <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addEditSpecRow()"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
                </div>
                <div id="edit-p-spec-list" class="space-y-2">${specInputs}</div>
                <div id="edit-spec-item-counter" style="margin-top:8px;font-size:11px;font-weight:600;color:#86868b"></div>
            </div>
        `) : `
        ${createFormSection('ph-cpu', 'Processor / Platform', 'Supported processors and platforms.', `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <div class="field-label" style="margin:0">Processor / Platform</div>
                    <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addEditNsRow('platform')"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
                </div>
                <div class="field-hint" style="margin-bottom:8px">Processor / Platform and Key Specifications share a combined max of ${HW_NS_MAX_ITEMS} (min ${HW_KEY_SPEC_MIN_ITEMS}).</div>
                <div id="edit-p-platform-list" class="space-y-2">${editNsPlatformRows}</div>
            </div>`)}
        ${createFormSection('ph-sliders-horizontal', 'Key Specifications', 'Technical specifications.', `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <div class="field-label" style="margin:0">Key Specifications</div>
                    <button type="button" class="btn-ghost" style="font-size:12px;padding:3px 8px" onclick="addEditNsRow('spec')"><i class="ph ph-plus" style="font-size:11px"></i> Add</button>
                </div>
                <div class="field-hint" style="margin-bottom:8px">Processor / Platform and Key Specifications share a combined max of ${HW_NS_MAX_ITEMS} (min ${HW_KEY_SPEC_MIN_ITEMS}).</div>
                <div id="edit-p-nsspec-list" class="space-y-2">${editNsSpecRows}</div>
                <div id="edit-ns-item-counter" style="margin-top:8px;font-size:11px;font-weight:600;color:#86868b"></div>
            </div>`)}
        `}
        ${createFormSection('ph-image', 'Product Image', 'Main product image for the storefront card.', `
            <div>
                <label class="field-label">Product Image</label>
                <label class="file-upload-wrap">
                    <input id="edit-p-hw-image" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onchange="handleEditHwImageUpload(this)">
                    <span class="file-upload-btn"><i class="ph ph-upload-simple"></i> Choose File</span>
                    <span class="file-upload-text">5MB max · JPG / JPEG / PNG</span>
                </label>
                <div id="edit-p-hw-image-error" class="field-error-text"></div>
            </div>
            <div id="edit-p-hw-image-status"></div>
        `)}
        ${createFormSection('ph-sparkle', 'Frontend Display', 'Storefront badge and link treatment.', `
            <label class="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" id="edit-p-aidaptiv" class="w-4 h-4 rounded border-[#e8eaed] accent-aiso" ${p.is_aidaptiv ? 'checked' : ''}>
                <div>
                    <div class="text-sm font-semibold text-[#1d1d1f]">aiDAPTIV</div>
                    <div class="text-[11px] text-[#86868b]">Display aiDAPTIV logo, badge, and link on the frontend preview</div>
                </div>
            </label>
        `)}`;

    const modalHtml = `
        <div class="create-modal-shell">
            <div class="create-modal-header">
                <div class="create-modal-title-row">
                    <div class="create-modal-icon"><i class="ph ${isSW ? 'ph-app-window' : 'ph-hard-drives'}"></i></div>
                    <div class="min-w-0">
                        <div class="create-modal-kicker">${isSW ? 'Software' : 'Hardware'} · ${!isSW ? (hwFmt === 'standard' ? 'Standard' : 'Non-standard') + ' · ' : ''}Last updated ${esc(p.updated_at || '—')}</div>
                        <h3 class="text-xl font-bold truncate">Edit: ${esc(p.name)}</h3>
                    </div>
                </div>
                <button onclick="closeModal()" class="create-modal-close" aria-label="Close"><i class="ph ph-x text-xl"></i></button>
            </div>
            <div class="create-modal-grid">
                <div class="create-form-scroll">
                    <form id="edit-product-form" onsubmit="event.preventDefault();saveProduct('${p.id}')" novalidate>
                        ${isSW ? swFields : hwFields}
                        <div class="form-actions">
                            <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
                            <button type="submit" class="btn-primary">Save Changes</button>
                        </div>
                    </form>
                </div>
                <div id="edit-live-preview" class="create-preview-scroll ${isSW ? 'is-software' : 'is-hardware'}"></div>
            </div>
        </div>`;
    showModal(modalHtml, true);

    // Pre-fill values
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('edit-p-name', p.name);
    setVal('edit-p-vendor', p.vendor_name);
    updateCharCounter('edit-p-name');
    updateCharCounter('edit-p-vendor');
    if (isSW) {
        setVal('edit-p-tagline', p.tagline);
        setVal('edit-p-url', p.officialUrl);
        updateCharCounter('edit-p-tagline');
        updateCharCounter('edit-p-url');
        updateSwCategoryLimit('edit-p-categories');
    } else {
        setVal('edit-p-brand', p.brand);
        setVal('edit-p-model', p.model);
        updateCharCounter('edit-p-brand');
        updateCharCounter('edit-p-model');
        if ((p.product_format || 'standard') === 'standard') updateEditSpecCounter();
        else updateEditNsCounter();
    }
    // Render existing image status before binding the live preview.
    if (isSW) {
        renderEditSwImageStatus();
        renderEditSwIconStatus();
    } else {
        renderEditHwImageStatus();
    }

    // Setup live preview bindings
    if (isSW) {
        setupEditPreviewBindings('software');
        renderEditPreview('software');
    } else {
        setupEditPreviewBindings('hardware');
        renderEditPreview('hardware');
    }
}

/* ── Edit modal preview ── */
function setupEditPreviewBindings(type) {
    const form = document.getElementById('edit-product-form');
    if (!form) return;
    // Editing a field clears its error, matching the create form — otherwise a
    // required-field message stays on screen after the vendor has fixed it.
    const rerender = el => {
        setCreateError(el.id, '');
        if (type === 'software') clearSoftwareGroupError(el, SW_REQUIRED_IDS.edit);
        renderEditPreview(type);
    };
    form.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.type === 'file') return;
        if (el.type === 'checkbox') { el.addEventListener('change', () => rerender(el)); return; }
        el.addEventListener('input', () => rerender(el));
        el.addEventListener('change', () => rerender(el));
    });
}

function renderEditPreview(type) {
    const target = document.getElementById('edit-live-preview');
    if (!target) return;
    if (type === 'software') renderEditSwPreview(target);
    else renderEditHwPreview(target);
}

function renderEditSwPreview(target) {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const name = val('edit-p-name');
    const vendor = val('edit-p-vendor');
    const pitch = val('edit-p-tagline');
    const siteUrl = val('edit-p-url');
    const features = Array.from({ length: 5 }, (_, i) => val(`edit-p-feat-${i}`)).filter(Boolean);
    const industries = Array.from(document.querySelectorAll('#edit-p-industries input:checked')).map(cb => cb.value);
    const images = editSwImages;
    const icon = editSwIcon;
    const initials = name ? name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) : '';

    const PLACEHOLDER = 'color:#9aa6bf';
    const SVG_F = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const SVG_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:#7c8ec8;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';

    const featHtml = features.length
        ? `<ul class="sd-feature-list">${features.map(f => `<li class="sd-feature-item"><span class="sd-feature-dot"></span><span>${esc(f)}</span></li>`).join('')}</ul>`
        : `<div style="padding:12px 14px;${PLACEHOLDER};font-size:0.82rem">Add up to 5 key features...</div>`;
    const indHtml = industries.length
        ? `<div class="sd-industry-list">${industries.map(i => `<span class="sd-industry-chip">${esc(i)}</span>`).join('')}</div>`
        : `<div style="padding:12px 14px;${PLACEHOLDER};font-size:0.82rem">Select applicable industries...</div>`;
    const markContent = icon
        ? `<img src="${esc(icon.url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:20px">`
        : initials ? esc(initials) : '<i class="ph ph-package" style="font-size:1.4rem;opacity:0.5"></i>';

    target.innerHTML = `
        <div class="sw-preview-eyebrow"><i class="ph ph-eye" style="font-size:0.8rem"></i> Live Preview</div>
        <div class="software-live-preview">
            <div class="sd-hero" style="position:relative;padding-top:28px">
                <div class="sd-hero-header">
                    <div class="sd-mark">${markContent}</div>
                    <div style="min-width:0;flex:1">
                        <p class="sd-company">${vendor ? esc(vendor) : `<span style="${PLACEHOLDER}">Company Name</span>`}</p>
                        <h2 class="sd-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name ? esc(name) : `<span style="${PLACEHOLDER};font-weight:500">Product Name</span>`}</h2>
                        ${renderSwLicenseBadge(getSelectedLicense('edit-p-license'))}
                    </div>
                </div>
                <p class="sd-tagline">${pitch ? esc(pitch) : `<span style="${PLACEHOLDER}">Short product description...</span>`}</p>
            </div>
            <div class="sd-content">
                <section class="sd-meta-block"><div class="sd-meta-title">${SVG_F} Key Features</div>${featHtml}</section>
                ${renderPreviewGallery(images, 'edit')}
                <section class="sd-meta-block"><div class="sd-meta-title">${SVG_I} Applicable Industries</div>${indHtml}</section>
            </div>
            <div class="sd-action-footer" style="margin-top:auto">
                <button class="sd-action-primary" type="button">Select</button>
                ${renderSwSiteLink(siteUrl, { placeholder: 'Official website link...' })}
            </div>
        </div>`;
}

function renderEditHwPreview(target) {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const name = val('edit-p-name') || 'Product Name';
    const category = val('edit-p-hw-type');
    const isAidaptiv = document.getElementById('edit-p-aidaptiv')?.checked || false;
    const image = editHwImage;
    const imgHtml = image
        ? `<img src="${esc(image.url)}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#86868b"><i class="ph ph-image" style="font-size:2rem"></i></div>';
    const fmt = editHwFormat;
    const fmtBadge = `<span class="format-badge ${fmt === 'standard' ? 'is-standard' : 'is-nonstandard'}"><i class="ph ${fmt === 'standard' ? 'ph-list-bullets' : 'ph-cube'}"></i> ${fmt === 'standard' ? 'Standard' : 'Non-standard'}</span>`;

    if (fmt === 'nonstandard') {
        const platforms = collectNsItems('edit-p-platform');
        const nsSpecs = collectNsItems('edit-p-nsspec');
        target.innerHTML = `
            <div class="preview-eyebrow"><span class="preview-eyebrow-left"><i class="ph ph-eye" style="font-size:0.8rem"></i> Live Preview</span>${fmtBadge}</div>
            <div class="hw-preview-card">
                <div class="hw-preview-media">${imgHtml}</div>
                <div class="hw-preview-body">
                    <h4 class="hw-preview-title">${esc(name)}</h4>
                    <div class="hw-preview-category">${esc(category || 'Product Type')}</div>
                    <hr class="hw-preview-divider">
                    ${platforms.length ? `<div class="preview-section">
                        <div class="preview-section-title"><i class="ph ph-cpu" style="color:#7c8ec8"></i> Processor / Platform</div>
                        <ul class="hw-spec-list">${platforms.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul>
                    </div>` : ''}
                    ${nsSpecs.length ? `<div class="preview-section">
                        <div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div>
                        <ul class="hw-spec-list">${nsSpecs.map(s => '<li><span>' + esc(s) + '</span></li>').join('')}</ul>
                    </div>` : ''}
                    ${!platforms.length && !nsSpecs.length ? '<div style="padding:10px 14px;color:#6d7695;font-size:0.82rem;font-style:italic">Add platform or spec items...</div>' : ''}
                    ${isAidaptiv ? '<div class="hw-aidaptiv-row"><span style="font-size:1rem;font-weight:900;color:#1d1d1f">aiDAPTIV</span><span class="hw-aidaptiv-link">What is aiDaptiv?</span></div>' : ''}
                    <button type="button" class="hw-preview-cta">Select Hardware</button>
                </div>
            </div>
            <div style="margin-top:10px;text-align:center;font-size:0.62rem;color:#86868b;font-style:italic">Non-standard storefront card preview</div>`;
        return;
    }

    const specs = Array.from({ length: 8 }, (_, i) => val(`edit-p-spec-${i}`)).filter(Boolean);
    target.innerHTML = `
        <div class="preview-eyebrow"><span class="preview-eyebrow-left"><i class="ph ph-eye" style="font-size:0.8rem"></i> Live Preview</span>${fmtBadge}</div>
        <div class="hw-preview-card">
            <div class="hw-preview-media">${imgHtml}</div>
            <div class="hw-preview-body">
                <h4 class="hw-preview-title">${esc(name)}</h4>
                <div class="hw-preview-category">${esc(category || 'Product Type')}</div>
                <hr class="hw-preview-divider">
                <div class="preview-section">
                    <div class="preview-section-title"><i class="ph ph-sliders-horizontal" style="color:#7c8ec8"></i> Key Specifications</div>
                    ${specs.length ? '<ul class="hw-spec-list">' + specs.map(s => '<li><span>' + esc(s) + '</span></li>').join('') + '</ul>' : '<div style="padding:10px 14px 12px;color:#6d7695;font-size:0.82rem;font-style:italic">Fill in key specifications...</div>'}
                </div>
                ${isAidaptiv ? '<div class="hw-aidaptiv-row"><span style="font-size:1rem;font-weight:900;color:#1d1d1f">aiDAPTIV</span><span class="hw-aidaptiv-link">What is aiDaptiv?</span></div>' : ''}
                <button type="button" class="hw-preview-cta">Select Hardware</button>
            </div>
        </div>
        <div style="margin-top:10px;text-align:center;font-size:0.62rem;color:#86868b;font-style:italic">Standard storefront card preview</div>`;
}

/* ── Edit modal image handlers ── */
let editSwImages = [];
let editSwIcon = null;
let editHwImage = null;
let editHwFormat = 'standard';
// Where to return after saving an edit: 'list' (opened from the list) or 'detail' (opened from the detail page).
let editReturnView = 'detail';

function renderEditSwImageStatus() {
    const container = document.getElementById('edit-p-images-status');
    if (!container) return;
    const photos = editSwImages;
    if (!photos.length) { container.innerHTML = ''; return; }
    container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:11px;color:#86868b;font-weight:600">${photos.length}/${PRODUCT_IMAGE_MAX_COUNT} images</span>
            <button type="button" class="btn-ghost py-1 px-2" onclick="clearEditSwImages()"><i class="ph ph-trash"></i> Delete all</button>
        </div>
        <div class="product-image-sort-list">${photos.map((img, i) => renderSortableProductImage(img, i, 'edit')).join('')}</div>
        ${photos.length > 1 ? '<div class="product-image-sort-hint"><i class="ph ph-arrows-out-line-horizontal"></i> Drag images to reorder. The first image is the main image.</div>' : ''}`;
}

function removeEditSwImage(index) {
    editSwImages.splice(index, 1);
    renderEditSwImageStatus();
    renderEditPreview('software');
}

function clearEditSwImages() {
    editSwImages = [];
    renderEditSwImageStatus();
    renderEditPreview('software');
}

function renderEditSwIconStatus() {
    const statusEl = document.getElementById('edit-p-icon-status');
    if (!statusEl) return;
    statusEl.innerHTML = editSwIcon ? renderSingleProductImage(editSwIcon, 'removeEditSoftwareIcon()') : '';
}

function renderEditHwImageStatus() {
    const statusEl = document.getElementById('edit-p-hw-image-status');
    if (!statusEl) return;
    statusEl.innerHTML = editHwImage ? renderSingleProductImage(editHwImage, 'removeEditHardwareImage()') : '';
}

function removeEditSoftwareIcon() {
    editSwIcon = null;
    const input = document.getElementById('edit-p-icon');
    if (input) input.value = '';
    renderEditSwIconStatus();
    renderEditPreview('software');
}

function removeEditHardwareImage() {
    editHwImage = null;
    const input = document.getElementById('edit-p-hw-image');
    if (input) input.value = '';
    renderEditHwImageStatus();
    renderEditPreview('hardware');
}

function handleEditSwImageUpload(input) {
    setCreateError('edit-p-images', '');
    const files = Array.from(input.files || []);
    const validation = validateProductImageFiles(files, {
        currentCount: editSwImages.length,
        maxCount: PRODUCT_IMAGE_MAX_COUNT,
    });
    if (!validation.valid) {
        setProductImageValidationError('edit-p-images', validation);
        input.value = '';
        return;
    }
    editSwImages.push(...files.map(f => {
        const obj = { file: f, name: f.name, url: URL.createObjectURL(f) };
        obj.dataPromise = Store.compressImage(f).then(d => { obj.dataUrl = d; }).catch(() => {});
        return obj;
    }));
    input.value = '';
    renderEditSwImageStatus();
    renderEditPreview('software');
}

function handleEditSwIconUpload(input) {
    setCreateError('edit-p-icon', '');
    const file = input.files?.[0];
    if (!file) return;
    const validation = validateProductImageFiles([file], { required: true });
    if (!validation.valid) {
        setProductImageValidationError('edit-p-icon', validation);
        input.value = ''; return;
    }
    openProductIconCropper(file, 'edit', 'edit-p-icon');
}

function handleEditHwImageUpload(input) {
    setCreateError('edit-p-hw-image', '');
    const file = input.files?.[0];
    if (!file) return;
    const validation = validateProductImageFiles([file], { required: true });
    if (!validation.valid) {
        setProductImageValidationError('edit-p-hw-image', validation);
        input.value = ''; return;
    }
    editHwImage = { file, name: file.name, url: URL.createObjectURL(file) };
    const editHwImgObj = editHwImage;
    editHwImgObj.dataPromise = Store.compressImage(file).then(d => { editHwImgObj.dataUrl = d; }).catch(() => {});
    renderEditPreview('hardware');
    renderEditHwImageStatus();
}

async function saveProduct(pid) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    const isSW = p.product_type === 'software';
    const val = id => (document.getElementById(id)?.value || '').trim();

    const isNsHw = !isSW && (p.product_format || 'standard') === 'nonstandard';

    // Basic validation
    if (!val('edit-p-name')) { showToast('Please fix the highlighted fields', 'error'); setCreateError('edit-p-name', 'Please enter Product Name.'); return; }
    if (!isNsHw && !val('edit-p-vendor')) { showToast('Please fix the highlighted fields', 'error'); setCreateError('edit-p-vendor', 'Please enter Vendor.'); return; }
    // Software required fields follow the same rules as the create form, so an
    // edited product can never end up less complete than a newly created one.
    if (isSW && !validateSoftwareRequiredFields(SW_REQUIRED_IDS.edit, { hasIcon: !!(editSwIcon || p.icon_data) })) {
        showToast('Please fix the highlighted fields', 'error');
        return;
    }
    if (!isSW && (p.product_format || 'standard') === 'standard') {
        if (!val('edit-p-brand')) { showToast('Please fix the highlighted fields', 'error'); setCreateError('edit-p-brand', 'Please enter Brand.'); return; }
        if (!val('edit-p-model')) { showToast('Please fix the highlighted fields', 'error'); setCreateError('edit-p-model', 'Please enter Model.'); return; }
        const editSpecs = collectNsItems('edit-p-spec');
        if (editSpecs.length < HW_KEY_SPEC_MIN_ITEMS) { showToast(`At least ${HW_KEY_SPEC_MIN_ITEMS} specifications required`, 'error'); return; }
    }
    if (isNsHw) {
        if (collectNsItems('edit-p-platform').length + collectNsItems('edit-p-nsspec').length < HW_KEY_SPEC_MIN_ITEMS) {
            showToast(`At least ${HW_KEY_SPEC_MIN_ITEMS} items across Processor/Platform and Key Specifications`, 'error'); return;
        }
    }

    await Promise.all([
        ...editSwImages.map(img => img.dataPromise),
        editSwIcon?.dataPromise,
        editHwImage?.dataPromise,
    ].filter(Boolean));

    // Editing a live (published) product sends it back to Draft so the
    // change must be re-published before it goes live again. Drafts /
    // archived keep their status.
    const wasPublished = p.status === 'published';
    let strippedRefs = 0;
    const saved = commitPortalMutation(() => {
        p.name = val('edit-p-name') || p.name;
        if (!isNsHw) p.vendor_name = val('edit-p-vendor') || p.vendor_name;
        p.updated_at = new Date().toISOString().slice(0, 10);

        if (isSW) {
            p.categories = getCheckedValues('edit-p-categories').slice(0, SW_CATEGORY_MAX);
            p.sub_category = p.categories[0] || p.sub_category;
            p.tagline = val('edit-p-tagline');
            p.officialUrl = normalizeProductUrl(val('edit-p-url'));
            p.license_offer = getSelectedLicense('edit-p-license');
            p.features = Array.from({ length: SOFTWARE_FEATURE_MAX_ITEMS }, (_, i) => val(`edit-p-feat-${i}`)).filter(Boolean);
            p.industries = Array.from(document.querySelectorAll('#edit-p-industries input:checked')).map(cb => cb.value);
            const photoData = editSwImages.map(img => img.dataUrl || img.url || '').filter(Boolean);
            p.photos = editSwImages.map(img => img.name);
            p.image_name = editSwImages[0]?.name || '';
            p.photos_data = photoData;
            p.image_data = photoData[0] || '';
            p.icon_name = editSwIcon?.name || '';
            p.icon_data = editSwIcon?.dataUrl || editSwIcon?.url || '';
        } else {
            const hwFmt = p.product_format || 'standard';
            p.sub_category = val('edit-p-hw-type') || p.sub_category;
            p.is_aidaptiv = document.getElementById('edit-p-aidaptiv')?.checked || false;
            if (hwFmt === 'standard') {
                p.brand = val('edit-p-brand') || p.brand;
                p.model = val('edit-p-model') || p.model;
                p.key_specifications = collectNsItems('edit-p-spec');
            } else {
                p.ns_platforms = collectNsItems('edit-p-platform');
                p.key_specifications = collectNsItems('edit-p-nsspec');
            }
            const hwImageData = editHwImage?.dataUrl || editHwImage?.url || '';
            p.image_name = editHwImage?.name || '';
            p.photos = editHwImage ? [editHwImage.name] : [];
            p.image_data = hwImageData;
            p.photos_data = hwImageData ? [hwImageData] : [];
        }

        if (wasPublished) {
            p.status = 'draft';
            // A referenced HW reverting to Draft would leave stale SW compatibility refs;
            // strip them now (same cleanup as unpublish/archive/delete) so nothing dangles.
            if (p.product_type === 'hardware') {
                strippedRefs = findCompatRefs(p.id).length;
                if (strippedRefs) removeCompatRefs(p.id);
            }
        }

        logActivity('Updated', p.name, 'Draft updated');
        if (wasPublished) logActivity('Unpublished', p.name, 'Edited while live — moved to Draft, re-publish to go live');
    });
    if (!saved) return;

    // Reset temporary image state only after the save succeeds. A failed submit
    // leaves both the modal and its selected files intact for retrying.
    editSwImages = []; editSwIcon = null; editHwImage = null;
    closeModal();
    showToast(wasPublished
        ? `${p.name} updated — moved to Draft${strippedRefs ? `, removed from ${strippedRefs} software` : ''}. Re-publish to make it live.`
        : `${p.name} updated`, 'success');
    // Return to wherever Edit was opened from: stay on the list when opened
    // from the list, or re-open the detail page when opened from the detail.
    if (isSW) { renderSwProducts(); if (editReturnView === 'detail') showSwDetail(pid); }
    else { renderHwProducts(); if (editReturnView === 'detail') showHwDetail(pid); }
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════

const MODAL_FAILURE_DEMOS = Object.freeze({
    create: {
        title: 'Add product',
        description: 'Enter a product name and submit. The simulated API will fail before the draft is saved.',
        submitLabel: 'Create Draft',
        icon: 'ph-plus-circle',
    },
    edit: {
        title: 'Edit product',
        description: 'Change the product name and save. The simulated API will fail and the original data will be restored.',
        submitLabel: 'Save Changes',
        icon: 'ph-pencil-simple',
    },
    delete: {
        title: 'Delete product',
        description: 'Submit the deletion request for an archived product. The simulated API will fail and the product will remain available.',
        submitLabel: 'Delete Product',
        icon: 'ph-trash',
        destructive: true,
    },
    unpublish: {
        title: 'Unpublish product',
        description: 'Submit the unpublish request. The simulated API will fail and the published status will be restored.',
        submitLabel: 'Unpublish',
        icon: 'ph-arrow-line-down',
    },
});

function showModalFailureDemo(action) {
    const config = MODAL_FAILURE_DEMOS[action];
    if (!config) return;
    const product = action === 'unpublish'
        ? PRODUCTS.find(item => item.status === 'published')
        : action === 'delete'
            ? PRODUCTS.find(item => item.status === 'archived')
            : PRODUCTS[0];
    const productId = product?.id || '';
    const fieldLabel = action === 'delete' ? 'Type the product name to confirm' : 'Product Name';
    const fieldValue = action === 'create' ? 'API Failure Test Product' : (product?.name || 'Sample Product');
    const buttonStyle = config.destructive ? 'background:#dc2626' : (action === 'unpublish' ? 'background:#d97706' : '');

    showModal(`
        <form id="modal-failure-demo-form" onsubmit="event.preventDefault();submitModalFailureDemo('${action}','${esc(productId)}')">
            <div style="text-align:center;padding:0.35rem 0 0.15rem">
                <div style="width:56px;height:56px;border-radius:16px;background:${config.destructive ? '#fef2f2' : '#eef1ff'};display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
                    <i class="ph ${config.icon}" style="font-size:28px;color:${config.destructive ? '#dc2626' : '#1432E6'}"></i>
                </div>
                <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">${esc(config.title)} API failure test</h3>
                <p style="font-size:13px;color:#86868b;margin:0 0 20px;line-height:1.6">${esc(config.description)}</p>
            </div>
            <label class="field-label" for="modal-failure-demo-input">${esc(fieldLabel)}</label>
            <input id="modal-failure-demo-input" class="input-field" value="${esc(fieldValue)}" autocomplete="off">
            <div id="modal-failure-demo-status" style="min-height:36px;margin-top:10px;padding:9px 12px;border-radius:10px;background:#f5f5f7;color:#86868b;font-size:12px;line-height:1.5">
                This test always simulates a 500 response. No workspace data will be changed.
            </div>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:22px">
                <button type="button" onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button type="submit" class="btn-primary" style="${buttonStyle}"><i class="ph ${config.icon}"></i> ${esc(config.submitLabel)}</button>
            </div>
        </form>`);
}

function submitModalFailureDemo(action, pid) {
    const config = MODAL_FAILURE_DEMOS[action];
    if (!config) return;
    const field = document.getElementById('modal-failure-demo-input');
    const value = (field?.value || '').trim();
    if (!value) {
        field?.classList.add('field-error');
        showToast('Please enter the required value.', 'error');
        return;
    }
    field?.classList.remove('field-error');

    const failureMessage = `${config.title} failed: API did not respond. Please try again.`;
    const saved = commitPortalMutation(() => {
        const product = PRODUCTS.find(item => item.id === pid);
        if (action === 'create') {
            PRODUCTS.push({ id: `failure-demo-${Date.now()}`, name: value, product_type: 'software', status: 'draft' });
        } else if (action === 'edit' && product) {
            product.name = value;
        } else if (action === 'delete' && product?.status === 'archived') {
            PRODUCTS.splice(PRODUCTS.indexOf(product), 1);
        } else if (action === 'unpublish' && product) {
            product.status = 'draft';
        }
    }, failureMessage, () => false);

    if (saved) {
        closeModal();
        return;
    }
    const status = document.getElementById('modal-failure-demo-status');
    if (status) {
        status.style.background = '#fef2f2';
        status.style.color = '#dc2626';
        status.textContent = '500 simulated: data was restored, and this modal and its form values remain open for retrying.';
    }
}


// ═══════════════════════════════════════════════════════════════════
// PENDING CHANGES — shared draft layer for Parameter Center and
// Compatibility Mapping. Every edit on those two views is staged in a
// draft; nothing is written to PRODUCTS or localStorage until the user
// presses Save and confirms.
// ═══════════════════════════════════════════════════════════════════

const PENDING_SCOPES = ['param-center', 'compatibility'];

// Draft state, one per scope. null means the view is not currently open.
let paramDraft = null;
let compatDraft = null;

function publishedOrderIds(type) {
    return PRODUCTS
        .filter(p => p.product_type === type && p.status === 'published')
        .sort((a, b) => (a.display_order || 999) - (b.display_order || 999))
        .map(p => p.id);
}

function startParamDraft() {
    paramDraft = {
        'sw-cat': SOFTWARE_CATEGORY_OPTIONS.map(o => ({ ...o })),
        'sw-ind': SOFTWARE_INDUSTRY_OPTIONS.map(o => ({ ...o })),
        'hw-type': HARDWARE_PRODUCT_TYPES.map(o => ({ ...o })),
        order: { software: publishedOrderIds('software'), hardware: publishedOrderIds('hardware') },
    };
}

function startCompatDraft() {
    compatDraft = {};
    PRODUCTS
        .filter(p => p.product_type === 'software' && p.status === 'published')
        .forEach(p => { compatDraft[p.id] = Array.from(new Set(p.compatible_hardware || [])); });
}

/* ── Change detection ──
   Each entry is { label, apply } so the confirmation modal, the counter and
   the commit all read from a single description of what changed. */

const PARAM_LIST_LABELS = {
    'sw-cat': 'Software category',
    'sw-ind': 'Applicable industry',
    'hw-type': 'Hardware product type',
};

function paramLiveArr(prefix) {
    if (prefix === 'sw-cat') return SOFTWARE_CATEGORY_OPTIONS;
    if (prefix === 'sw-ind') return SOFTWARE_INDUSTRY_OPTIONS;
    if (prefix === 'hw-type') return HARDWARE_PRODUCT_TYPES;
    return [];
}

function getParamPendingChanges() {
    if (!paramDraft) return [];
    const changes = [];
    Object.keys(PARAM_LIST_LABELS).forEach(prefix => {
        const noun = PARAM_LIST_LABELS[prefix];
        const live = paramLiveArr(prefix);
        const draft = paramDraft[prefix];
        const liveByLabel = new Map(live.map(o => [o.label, o]));
        const draftByLabel = new Map(draft.map(o => [o.label, o]));
        draft.forEach(item => {
            const before = liveByLabel.get(item.label);
            if (!before) changes.push({ label: `${noun} "${item.label}" added` });
            else if (before.is_active !== item.is_active) {
                changes.push({ label: `${noun} "${item.label}" ${item.is_active ? 'enabled' : 'disabled'}` });
            }
        });
        live.forEach(item => {
            if (!draftByLabel.has(item.label)) changes.push({ label: `${noun} "${item.label}" deleted` });
        });
    });
    ['software', 'hardware'].forEach(type => {
        const before = publishedOrderIds(type);
        const after = paramDraft.order[type];
        if (before.length !== after.length || before.some((id, i) => id !== after[i])) {
            changes.push({ label: `${type === 'software' ? 'Software' : 'Hardware'} display order reordered` });
        }
    });
    return changes;
}

function getCompatPendingChanges() {
    if (!compatDraft) return [];
    const changes = [];
    Object.keys(compatDraft).forEach(softwareId => {
        const software = PRODUCTS.find(p => p.id === softwareId);
        if (!software) return;
        const before = Array.from(new Set(software.compatible_hardware || []));
        const after = compatDraft[softwareId];
        const added = after.filter(id => !before.includes(id));
        const removed = before.filter(id => !after.includes(id));
        if (!added.length && !removed.length) return;
        const nameOf = id => PRODUCTS.find(p => p.id === id)?.name || id;
        const parts = [];
        if (added.length) parts.push(`+${added.map(nameOf).join(', ')}`);
        if (removed.length) parts.push(`−${removed.map(nameOf).join(', ')}`);
        changes.push({ label: `${software.name}: ${parts.join(' · ')}`, softwareId, added, removed });
    });
    return changes;
}

function getPendingChanges(scope) {
    return scope === 'param-center' ? getParamPendingChanges() : getCompatPendingChanges();
}

function hasPendingChanges(scope) {
    return getPendingChanges(scope).length > 0;
}

function getDirtyScope() {
    return PENDING_SCOPES.find(scope => hasPendingChanges(scope)) || null;
}

/* ── Shared Save bar ── */

function pendingBarHost(scope) {
    return document.getElementById(scope === 'param-center' ? 'param-pending-bar' : 'compat-pending-bar');
}

function renderPendingBar(scope) {
    const host = pendingBarHost(scope);
    if (!host) return;
    const count = getPendingChanges(scope).length;
    if (!count) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `
        <div class="pending-bar-inner">
            <span class="pending-bar-label"><i class="ph ph-warning-circle"></i> ${count} unsaved change${count === 1 ? '' : 's'}</span>
            <div style="display:flex;gap:8px">
                <button type="button" class="btn-secondary" onclick="discardPendingChanges('${scope}')">Discard</button>
                <button type="button" class="btn-primary" onclick="confirmPendingChanges('${scope}')"><i class="ph ph-floppy-disk"></i> Save</button>
            </div>
        </div>`;
}

function rerenderScope(scope) {
    if (scope === 'param-center') renderParamCenter();
    else renderCompatibilityCenter();
}

function discardPendingChanges(scope) {
    if (scope === 'param-center') startParamDraft();
    else startCompatDraft();
    rerenderScope(scope);
    showToast('Unsaved changes discarded.');
}

function confirmPendingChanges(scope) {
    const changes = getPendingChanges(scope);
    if (!changes.length) return;
    showModal(`
        <div>
            <div style="width:52px;height:52px;border-radius:16px;background:#eef1ff;display:grid;place-items:center;margin-bottom:16px"><i class="ph ph-floppy-disk" style="font-size:26px;color:#1432E6"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 6px">Save these changes?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">${changes.length} change${changes.length === 1 ? '' : 's'} will be applied and take effect immediately.</p>
            <div style="display:grid;gap:6px;max-height:260px;overflow-y:auto;margin:0 0 22px">
                ${changes.map(c => `<div style="font-size:13px;color:#1d1d1f;padding:9px 12px;border:1px solid #f1f3f5;border-radius:10px;background:#fafbfc">${esc(c.label)}</div>`).join('')}
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="button" class="btn-primary" onclick="savePendingChanges('${scope}')"><i class="ph ph-check"></i> Confirm &amp; Save</button>
            </div>
        </div>`);
}

function savePendingChanges(scope) {
    const changes = getPendingChanges(scope);
    if (!changes.length) { closeModal(); return; }
    const saved = scope === 'param-center' ? applyParamDraft(changes) : applyCompatDraft(changes);
    if (!saved) return;
    closeModal();
    if (scope === 'param-center') startParamDraft(); else startCompatDraft();
    rerenderScope(scope);
    showToast(TOAST_SAVE_SUCCESS);
}

function replaceArrayContents(target, source) {
    target.length = 0;
    source.forEach(item => target.push({ ...item }));
}

function applyParamDraft(changes) {
    const draft = paramDraft;
    return commitPortalMutation(() => {
        replaceArrayContents(SOFTWARE_CATEGORY_OPTIONS, draft['sw-cat']);
        replaceArrayContents(SOFTWARE_INDUSTRY_OPTIONS, draft['sw-ind']);
        replaceArrayContents(HARDWARE_PRODUCT_TYPES, draft['hw-type']);
        ['software', 'hardware'].forEach(type => {
            // Published products take positions 1..N in the drafted order; the
            // rest keep their relative order behind them.
            const ordered = draft.order[type].map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
            const others = PRODUCTS
                .filter(p => p.product_type === type && p.status !== 'published')
                .sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
            [...ordered, ...others].forEach((p, i) => { p.display_order = i + 1; });
        });
        changes.forEach(change => logActivity('Parameter updated', 'Parameter Center', change.label));
    });
}

function applyCompatDraft(changes) {
    const today = new Date().toISOString().slice(0, 10);
    return commitPortalMutation(() => {
        changes.forEach(change => {
            const software = PRODUCTS.find(p => p.id === change.softwareId);
            if (!software) return;
            software.compatible_hardware = [...compatDraft[change.softwareId]];
            software.updated_at = today;
            const nameOf = id => PRODUCTS.find(p => p.id === id)?.name || id;
            const detailParts = [];
            if (change.added.length) detailParts.push(`Added: ${change.added.map(nameOf).join(', ')}`);
            if (change.removed.length) detailParts.push(`Removed: ${change.removed.map(nameOf).join(', ')}`);
            logActivity('Compatibility updated', software.name, detailParts.join(' · ') || 'Mapping cleared', software.id);
        });
    });
}

/* ── Leaving a view with unsaved changes ── */

function confirmLeavePending(scope, nextKey) {
    const count = getPendingChanges(scope).length;
    showModal(`
        <div>
            <div style="width:52px;height:52px;border-radius:16px;background:#fffbeb;display:grid;place-items:center;margin-bottom:16px"><i class="ph ph-warning-circle" style="font-size:26px;color:#d97706"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 6px">Leave without saving?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 22px;line-height:1.6">You have ${count} unsaved change${count === 1 ? '' : 's'} on this page. Leaving will discard ${count === 1 ? 'it' : 'them'}.</p>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button type="button" class="btn-secondary" onclick="closeModal()">Stay on page</button>
                <button type="button" class="btn-primary" style="background:#dc2626" onclick="closeModal();leavePendingScope('${scope}','${nextKey}')"><i class="ph ph-arrow-right"></i> Discard &amp; Leave</button>
            </div>
        </div>`);
}

function leavePendingScope(scope, nextKey) {
    if (scope === 'param-center') paramDraft = null; else compatDraft = null;
    navigate(nextKey);
}

// ═══════════════════════════════════════════════════════════════════
// PARAMETER CENTER
// ═══════════════════════════════════════════════════════════════════

function switchParamTab(tab) {
    document.querySelectorAll('.param-tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('param-tab-' + tab)?.classList.remove('hidden');
    document.querySelectorAll('[data-param-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.paramTab === tab);
    });
}

function renderParamCenter() {
    if (!paramDraft) startParamDraft();
    // Software Packaging is disabled: its section is hidden and never rendered.
    renderParamTagList('param-sw-categories', getParamDataArr('sw-cat'), 'sw-cat');
    renderParamTagList('param-sw-industries', getParamDataArr('sw-ind'), 'sw-ind');
    renderParamTagList('param-hw-types', getParamDataArr('hw-type'), 'hw-type');
    renderDisplayOrder('software');
    renderDisplayOrder('hardware');
    renderPendingBar('param-center');
}

// ═══════════════════════════════════════════════════════════════════
// COMPATIBILITY MAPPING — standalone view, parallel to Parameter Center
// ═══════════════════════════════════════════════════════════════════

// Reads the drafted mapping while the view is open so the table shows staged
// edits; falls back to the saved mapping otherwise.
function getCompatibilityMapping(product) {
    if (compatDraft && compatDraft[product.id]) return compatDraft[product.id];
    return product.compatible_hardware || [];
}

function getCompatibilityHardware(product) {
    return getCompatibilityMapping(product)
        .map(hardwareId => PRODUCTS.find(item => item.id === hardwareId && item.product_type === 'hardware'))
        .filter(Boolean);
}

function renderCompatibilityCenter() {
    if (!canViewCompatibility()) return;
    if (!compatDraft) startCompatDraft();
    const target = document.getElementById('compat-tbody');
    const summary = document.getElementById('compat-summary');
    if (!target) return;

    const publishedSoftware = PRODUCTS.filter(product => product.product_type === 'software' && product.status === 'published');
    const mappedCount = publishedSoftware.filter(product => getCompatibilityHardware(product).length > 0).length;
    const publishedHardwareCount = PRODUCTS.filter(product => product.product_type === 'hardware' && product.status === 'published').length;
    const unconfiguredCount = publishedSoftware.length - mappedCount;
    const summaryChip = (label, count, color) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;background:#fafbfc;border:1px solid var(--border-light)">
        <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
        <strong style="font-size:12px;color:#1d1d1f">${count}</strong>
        <span style="font-size:11px;color:#86868b;font-weight:500">${label}</span>
    </div>`;
    if (summary) {
        summary.innerHTML = summaryChip('Published software', publishedSoftware.length, '#1d1d1f')
            + summaryChip('Mapped', mappedCount, '#059669')
            + summaryChip('Not configured', unconfiguredCount, '#d97706')
            + summaryChip('Published hardware', publishedHardwareCount, '#1432e6');
    }

    const search = (document.getElementById('compat-search')?.value || '').trim().toLowerCase();
    const rows = publishedSoftware
        .filter(product => !search || [product.name, product.vendor_name, product.tagline, product.sub_category]
            .some(value => String(value || '').toLowerCase().includes(search)))
        .sort((a, b) => a.name.localeCompare(b.name));

    const pendingChangeIds = new Set(getCompatPendingChanges().map(change => change.softwareId));
    target.innerHTML = rows.length ? rows.map(product => {
        const hardware = getCompatibilityHardware(product);
        const shown = hardware.slice(0, 2);
        const remaining = hardware.length - shown.length;
        const canEdit = canManageCompatibility();
        const isPending = pendingChangeIds.has(product.id);
        const hardwareHtml = hardware.length
            ? `<div class="flex flex-wrap gap-1.5">${shown.map(item => `<span class="badge badge-zinc">${esc(item.name)}</span>`).join('')}${remaining > 0 ? `<span class="badge badge-zinc">+${remaining}</span>` : ''}</div>`
            : '<span style="font-size:12px;color:#86868b"><i class="ph ph-minus-circle"></i> Not configured</span>';
        return `<tr>
            <td>
                <div class="flex items-center gap-3">
                    ${swListIcon(product, { size: 36, radius: 10 }, `<div style="width:36px;height:36px;border-radius:10px;background:#f5f5f7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#86868b;flex-shrink:0">${esc(product.name.slice(0, 2).toUpperCase())}</div>`)}
                    <div style="min-width:0">
                        <div style="font-weight:600;font-size:13.5px;color:#1d1d1f">${esc(product.name)}${isPending ? ' <span class="badge badge-orange">Unsaved</span>' : ''}</div>
                        <div style="font-size:12px;color:#86868b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(product.tagline || '')}">${esc(product.vendor_name || '—')} · ${esc(product.tagline || product.sub_category || 'Software')}</div>
                    </div>
                </div>
            </td>
            <td>${hardwareHtml}</td>
            <td class="text-right">
                <button type="button" class="btn-ghost" onclick="showCompatibilityModal('${product.id}')" ${canEdit ? '' : 'disabled'} title="${canEdit ? 'Edit' : 'Permission required'}"><i class="ph ph-pencil-simple"></i></button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="3" class="text-center py-16">${emptyState('ph-arrows-left-right', search ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA)}</td></tr>`;

    renderPendingBar('compatibility');
}

function showCompatibilityModal(softwareId) {
    if (!canManageCompatibility()) {
        showToast('You do not have permission to update compatibility mappings.', 'error');
        return;
    }
    const software = PRODUCTS.find(product => product.id === softwareId && product.product_type === 'software');
    if (!software) return;
    if (software.status !== 'published') {
        showToast('Only published software compatibility can be edited.', 'error');
        return;
    }

    if (!compatDraft) startCompatDraft();
    const selectedIds = new Set(getCompatibilityMapping(software));
    const publishedHardware = PRODUCTS
        .filter(product => product.product_type === 'hardware' && product.status === 'published')
        .sort((a, b) => a.name.localeCompare(b.name));
    const unavailableSelected = Array.from(selectedIds)
        .map(hardwareId => PRODUCTS.find(product => product.id === hardwareId && product.product_type === 'hardware'))
        .filter(product => product && product.status !== 'published');
    const hardwareCategories = Array.from(new Set(publishedHardware.map(hardware => hardware.sub_category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const hardwareRows = publishedHardware.map(hardware => {
        const searchValue = [hardware.name, hardware.vendor_name, hardware.brand, hardware.model, hardware.sub_category].filter(Boolean).join(' ').toLowerCase();
        return `<label class="compatibility-hardware-row" data-compat-search="${esc(searchValue)}" data-compat-category="${esc(hardware.sub_category || '')}" style="display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border-light);border-radius:12px;cursor:pointer;background:#fff">
            <input type="checkbox" name="compat-hardware" value="${esc(hardware.id)}" class="w-4 h-4 accent-aiso" ${selectedIds.has(hardware.id) ? 'checked' : ''} onchange="updateCompatibilitySelectionCount()">
            <span style="min-width:0;flex:1">
                <span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(hardware.name)}</span>
                <span style="display:block;font-size:11px;color:#86868b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([hardware.vendor_name, hardware.brand, hardware.model || hardware.sub_category].filter(Boolean).join(' · '))}</span>
            </span>
        </label>`;
    }).join('');

    showModal(`
        <div>
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px">
                <div>
                    <div style="font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:.06em">Compatibility Mapping</div>
                    <h3 style="font-size:1.15rem;font-weight:700;color:#1d1d1f;margin:4px 0">${esc(software.name)}</h3>
                    <p style="font-size:12px;color:#86868b;margin:0">Select published hardware products that can pair with this software.</p>
                </div>
                <button type="button" class="btn-ghost" onclick="closeModal()" aria-label="Close"><i class="ph ph-x" style="font-size:18px"></i></button>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
                <div class="filter-search" style="flex:1;max-width:none">
                    <i class="ph ph-magnifying-glass"></i>
                    <input id="compat-hardware-search" type="text" placeholder="Search hardware, brand, or model..." oninput="applyCompatibilityHardwareFilters()">
                </div>
                <span id="compat-selected-count" style="font-size:12px;font-weight:600;color:#1d2e7b">${publishedHardware.filter(item => selectedIds.has(item.id)).length} selected</span>
            </div>
            ${hardwareCategories.length ? `<div id="compat-cat-tabs" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:12px">
                <button type="button" class="filter-tab active" data-val="" onclick="setCompatCategoryFilter(this)">All</button>
                ${hardwareCategories.map(category => `<button type="button" class="filter-tab" data-val="${esc(category)}" onclick="setCompatCategoryFilter(this)">${esc(category)}</button>`).join('')}
            </div>` : ''}
            ${unavailableSelected.length ? `<div style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 11px;margin-bottom:12px"><i class="ph ph-warning-circle"></i> ${unavailableSelected.length} unavailable mapping${unavailableSelected.length === 1 ? '' : 's'} will be removed when you save.</div>` : ''}
            <div id="compat-hardware-list" style="display:grid;gap:8px;max-height:360px;overflow-y:auto;padding-right:3px">
                ${hardwareRows || '<div style="font-size:13px;color:#86868b;text-align:center;padding:28px 0">No published hardware products available.</div>'}
                <div id="compat-filter-empty" style="display:none;text-align:center;padding:28px 0">
                    <div style="font-size:13px;color:#86868b">No hardware matches the current filters.</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border-light)">
                <span style="font-size:11px;color:#86868b">Staged until you press Save on the Compatibility Mapping page.</span>
                <div style="display:flex;gap:8px;flex-shrink:0">
                    <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="button" class="btn-primary" onclick="applyCompatibilityMapping('${software.id}')"><i class="ph ph-check"></i> Apply</button>
                </div>
            </div>
        </div>`);
}

function applyCompatibilityHardwareFilters() {
    const query = (document.getElementById('compat-hardware-search')?.value || '').trim().toLowerCase();
    const category = document.querySelector('#compat-cat-tabs .filter-tab.active')?.dataset.val || '';
    let visibleCount = 0;
    document.querySelectorAll('.compatibility-hardware-row').forEach(row => {
        const matchesSearch = !query || (row.dataset.compatSearch || '').includes(query);
        const matchesCategory = !category || row.dataset.compatCategory === category;
        const visible = matchesSearch && matchesCategory;
        row.style.display = visible ? 'flex' : 'none';
        if (visible) visibleCount++;
    });
    const emptyState = document.getElementById('compat-filter-empty');
    if (emptyState) emptyState.style.display = visibleCount ? 'none' : 'block';
    updateCompatibilitySelectionCount();
}

function setCompatCategoryFilter(button) {
    document.querySelectorAll('#compat-cat-tabs .filter-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    applyCompatibilityHardwareFilters();
}

function updateCompatibilitySelectionCount() {
    const checked = Array.from(document.querySelectorAll('input[name="compat-hardware"]:checked'));
    const hiddenCount = checked.filter(input => input.closest('.compatibility-hardware-row')?.style.display === 'none').length;
    const target = document.getElementById('compat-selected-count');
    // Selections on rows hidden by search/category filters stay counted and are saved.
    if (target) target.textContent = `${checked.length} selected${hiddenCount ? ` (${hiddenCount} hidden by filters)` : ''}`;
}

// Stages the modal's selection into the draft. Nothing is persisted here; the
// page-level Save bar commits every staged mapping at once.
function applyCompatibilityMapping(softwareId) {
    if (!canManageCompatibility()) {
        showToast('You do not have permission to update compatibility mappings.', 'error');
        return;
    }
    const software = PRODUCTS.find(product => product.id === softwareId && product.product_type === 'software');
    if (!software || software.status !== 'published') return;
    if (!compatDraft) startCompatDraft();

    const previousIds = Array.from(new Set(getCompatibilityMapping(software)));
    const nextIds = Array.from(document.querySelectorAll('input[name="compat-hardware"]:checked')).map(input => input.value);
    const unchanged = previousIds.length === nextIds.length && previousIds.every(id => nextIds.includes(id));
    if (unchanged) {
        closeModal();
        showToast('No compatibility changes were made.');
        return;
    }

    // No toast here: staging is not a save, and the closed modal, the row's
    // "Unsaved" flag and the sticky Save bar already report the new state.
    compatDraft[softwareId] = nextIds;
    closeModal();
    renderCompatibilityCenter();
}

/* ── Packaging table ── */
function renderParamPackaging() {
    const swProducts = PRODUCTS.filter(p => p.product_type === 'software');
    document.getElementById('param-sw-packaging-tbody').innerHTML = swProducts.length
        ? swProducts.map(p => {
            const isBundled = p.sw_category === 'included';
            return `<tr>
                <td>
                    <div class="flex items-center gap-3">
                        <div style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#0f173a,#1d2e7b);color:#fff;font-size:0.55rem;font-weight:800;letter-spacing:0.06em;flex-shrink:0">${esc(p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2))}</div>
                        <div>
                            <div class="font-bold text-[#1d1d1f] text-sm">${esc(p.name)}</div>
                            <div class="text-xs text-[#86868b]">${esc(p.sub_category || '')}</div>
                        </div>
                    </div>
                </td>
                <td class="text-sm">${esc(p.vendor_name)}</td>
                <td>${statusBadge(p.status)}</td>
                <td>
                    <select class="border border-[#e8eaed] rounded-lg px-3 py-1.5 text-sm bg-white focus:border-aiso focus:outline-none cursor-pointer font-semibold ${isBundled ? 'text-emerald-700' : 'text-[#1d1d1f]'}"
                            onchange="updateSwPackaging('${p.id}', this.value)">
                        <option value="included" ${isBundled ? 'selected' : ''}>Bundled</option>
                        <option value="optional" ${!isBundled ? 'selected' : ''}>Add-on</option>
                    </select>
                </td>
            </tr>`;
        }).join('')
        : `<tr><td colspan="4" class="py-8">${emptyState('ph-app-window', EMPTY_STATE_NO_DATA)}</td></tr>`;
}

function updateSwPackaging(pid, value) {
    const p = PRODUCTS.find(x => x.id === pid);
    if (!p) return;
    if (!commitPortalMutation(() => { p.sw_category = value; })) {
        renderParamPackaging();
        return;
    }
    renderParamPackaging();
    showToast(`${p.name} updated to ${value === 'included' ? 'Bundled' : 'Add-on'}`);
}

/* ── Generic inline tag list ── */
function renderParamTagList(containerId, dataArr, prefix) {
    const target = document.getElementById(containerId);
    if (!target) return;
    const activeCount = dataArr.filter(o => o.is_active).length;
    const totalCount = dataArr.length;
    target.innerHTML = `
        <div class="flex items-center gap-2 mb-3">
            <span class="text-xs text-[#86868b] font-bold">${activeCount} active / ${totalCount} total</span>
        </div>
        <div class="flex flex-wrap gap-2 mb-4">
            ${dataArr.map((item, idx) => `
                <div class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition
                    ${item.is_active
                        ? 'bg-white border-[#e8eaed] text-[#1d1d1f]'
                        : 'bg-[#fafbfc] border-dashed border-[#e8eaed] text-[#86868b] line-through'}">
                    <span>${esc(item.label)}</span>
                    <button type="button" class="ml-1 w-5 h-5 rounded-full flex items-center justify-center text-xs transition
                        ${item.is_active
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-red-50 hover:text-red-500'
                            : 'bg-[#f5f5f7] text-[#86868b] hover:bg-emerald-50 hover:text-emerald-600'}"
                        onclick="toggleParamTag('${prefix}', ${idx})"
                        title="${item.is_active ? 'Disable' : 'Enable'}">
                        <i class="ph ${item.is_active ? 'ph-check' : 'ph-arrow-counter-clockwise'}" style="font-size:10px"></i>
                    </button>
                    <button type="button" class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[#f5f5f7] text-[#86868b] hover:bg-red-50 hover:text-red-500 transition"
                        onclick="confirmDeleteParamTag('${prefix}', ${idx})"
                        title="Delete">
                        <i class="ph ph-trash" style="font-size:10px"></i>
                    </button>
                </div>
            `).join('')}
        </div>
        <div class="flex items-center gap-2">
            <div class="relative flex-1 max-w-xs">
                <input id="${prefix}-new-input" type="text" maxlength="50" placeholder="Add new item..."
                    class="border border-[#e8eaed] rounded-lg px-3 py-1.5 pr-14 text-sm w-full focus:border-aiso focus:outline-none"
                    oninput="updateCharCounter('${prefix}-new-input')"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();addParamTag('${prefix}')}">
                <span id="${prefix}-new-input-count" class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#86868b] pointer-events-none">0/50</span>
            </div>
            <button type="button" class="btn-primary py-1.5 px-3 text-xs" onclick="addParamTag('${prefix}')">
                <i class="ph ph-plus"></i> Add
            </button>
        </div>`;
}

// While Parameter Center is open every read and write goes through the draft,
// so the UI reflects staged edits and the live arrays stay untouched until Save.
function getParamDataArr(prefix) {
    if (paramDraft && paramDraft[prefix]) return paramDraft[prefix];
    return paramLiveArr(prefix);
}

function getParamContainerId(prefix) {
    if (prefix === 'sw-cat') return 'param-sw-categories';
    if (prefix === 'sw-ind') return 'param-sw-industries';
    if (prefix === 'hw-type') return 'param-hw-types';
    return '';
}

function toggleParamTag(prefix, idx) {
    const arr = getParamDataArr(prefix);
    if (!arr[idx]) return;
    arr[idx].is_active = !arr[idx].is_active;
    renderParamTagList(getParamContainerId(prefix), arr, prefix);
    renderPendingBar('param-center');
}

function addParamTag(prefix) {
    const input = document.getElementById(prefix + '-new-input');
    const value = (input?.value || '').trim();
    if (!value) return;
    const arr = getParamDataArr(prefix);
    if (arr.some(o => o.label.toLowerCase() === value.toLowerCase())) {
        showToast('This item already exists', 'warning');
        return;
    }
    arr.push({ label: value, is_active: true });
    input.value = '';
    renderParamTagList(getParamContainerId(prefix), arr, prefix);
    renderPendingBar('param-center');
}

// Products currently using a given parameter value (so deletion can be blocked).
function findParamTagUsage(prefix, label) {
    if (prefix === 'sw-cat') {
        return PRODUCTS.filter(p => p.product_type === 'software'
            && ((p.categories || []).includes(label) || p.sub_category === label));
    }
    if (prefix === 'sw-ind') {
        return PRODUCTS.filter(p => p.product_type === 'software' && (p.industries || []).includes(label));
    }
    if (prefix === 'hw-type') {
        return PRODUCTS.filter(p => p.product_type === 'hardware' && p.sub_category === label);
    }
    return [];
}

function showParamTagUsageBlockedModal(item, used) {
    const refNames = used.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid #f1f3f5;border-radius:10px;background:#fafbfc;text-align:left">
            <span style="font-size:13px;font-weight:600;color:#1d1d1f">${esc(p.name)}</span>
            ${statusBadge(p.status)}
        </div>
    `).join('');
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#fef2f2;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-warning-circle" style="font-size:28px;color:#dc2626"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Cannot delete "${esc(item.label)}"</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">This parameter is currently used by ${used.length} product${used.length === 1 ? '' : 's'}:</p>
            <div style="display:grid;gap:8px;max-height:260px;overflow-y:auto;margin:0 0 16px">${refNames}</div>
            <p style="font-size:13px;color:#dc2626;background:#fef2f2;border-radius:10px;padding:10px 12px;margin:0 0 24px;line-height:1.6">Remove or replace this parameter on every product before deleting it.</p>
            <div style="display:flex;justify-content:center">
                <button onclick="closeModal()" class="btn-primary">Got It</button>
            </div>
        </div>`);
}

function confirmDeleteParamTag(prefix, idx) {
    const arr = getParamDataArr(prefix);
    const item = arr[idx];
    if (!item) return;
    const used = findParamTagUsage(prefix, item.label);
    // Not referenced anywhere → delete straight away.
    if (!used.length) { doDeleteParamTag(prefix, idx); return; }
    // In use → block deletion until every product has been adjusted explicitly.
    showParamTagUsageBlockedModal(item, used);
}

function doDeleteParamTag(prefix, idx) {
    const arr = getParamDataArr(prefix);
    const item = arr[idx];
    if (!item) return;
    const label = item.label;
    // Enforce referential integrity here as well as in the confirmation flow so
    // this function cannot be called directly to bypass the usage check.
    const used = findParamTagUsage(prefix, label);
    if (used.length) {
        showParamTagUsageBlockedModal(item, used);
        return;
    }
    arr.splice(idx, 1);
    closeModal();
    renderParamTagList(getParamContainerId(prefix), arr, prefix);
    renderPendingBar('param-center');
}

/* ── Display Order ── */
function renderDisplayOrder(type) {
    const containerId = type === 'software' ? 'param-sw-order' : 'param-hw-order';
    const target = document.getElementById(containerId);
    if (!target) return;
    // Only published products reach the storefront, so only they are listed here.
    // The order comes from the draft; display_order itself is rewritten only when
    // the user saves.
    const orderIds = paramDraft ? paramDraft.order[type] : publishedOrderIds(type);
    const items = orderIds.map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
    if (!items.length) {
        target.innerHTML = `<div class="py-8">${emptyState(type === 'software' ? 'ph-app-window' : 'ph-hard-drives', EMPTY_STATE_NO_DATA)}</div>`;
        return;
    }

    target.innerHTML = `<div class="order-list">${items.map((p, idx) => {
        // Hardware rows carry no icon; software shows its product icon.
        const icon = type === 'software'
            ? swListIcon(p, { size: 32, radius: 10 }, `<div style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#0f173a,#1d2e7b);color:#fff;font-size:0.55rem;font-weight:800;letter-spacing:0.06em;flex-shrink:0">${esc(p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2))}</div>`)
            : '';
        return `<div class="order-item is-draggable" draggable="true" ondragstart="onOrderDragStart(event,'${type}','${p.id}')" ondragover="onOrderDragOver(event)" ondragleave="onOrderDragLeave(event)" ondrop="onOrderDrop(event,'${type}','${p.id}')" ondragend="onOrderDragEnd(event)">
            <span class="order-grip" title="Drag to reorder"><i class="ph ph-dots-six-vertical" style="font-size:16px"></i></span>
            <div class="order-rank">${idx + 1}</div>
            ${icon}
            <div class="order-product-info">
                <div class="order-product-name">${esc(p.name)}</div>
                <div class="order-product-sub">${[esc(p.vendor_name || '—'), esc(p.sub_category || '')].filter(Boolean).join(' · ')}</div>
            </div>
            ${statusBadge(p.status)}
        </div>`;
    }).join('')}</div>`;
}

/* ── Display Order drag-and-drop ── */
let orderDragPid = null;

function onOrderDragStart(e, type, pid) {
    orderDragPid = pid;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', pid); } catch (err) { /* ignore */ }
    e.currentTarget.classList.add('is-dragging');
}

function onOrderDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onOrderDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onOrderDragEnd(e) {
    e.currentTarget.classList.remove('is-dragging');
    document.querySelectorAll('.order-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    orderDragPid = null;
}

function onOrderDrop(e, type, targetPid) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const pid = orderDragPid;
    orderDragPid = null;
    if (!pid || pid === targetPid) return;
    if (!paramDraft) startParamDraft();
    const order = paramDraft.order[type];
    const fromIdx = order.indexOf(pid);
    const toIdx = order.indexOf(targetPid);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
    renderDisplayOrder(type);
    renderPendingBar('param-center');
}

function renderSettings() {
    document.getElementById('settings-name').value = currentUser.name;
    document.getElementById('settings-email').value = currentUser.email;
    document.getElementById('settings-role').value = 'Super Admin (unrestricted cross-org access)';
}

function confirmResetDemoData() {
    showModal(`
        <div style="text-align:center;padding:1rem 0">
            <div style="width:56px;height:56px;border-radius:16px;background:#fef2f2;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><i class="ph ph-arrow-counter-clockwise" style="font-size:28px;color:#dc2626"></i></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Reset demo data?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 20px;line-height:1.6">This clears all locally saved changes and restores the original demo data. The page will reload.</p>
            <div style="display:flex;gap:10px;justify-content:center">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="Store.reset()" class="btn-primary" style="background:#dc2626"><i class="ph ph-arrow-counter-clockwise"></i> Reset Demo Data</button>
            </div>
        </div>`);
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT HISTORY (per-product timeline)
// ═══════════════════════════════════════════════════════════════════

const HISTORY_PAGE_SIZE = 5;

function renderProductHistory(p) {
    if (!p.history || !p.history.length) return '';
    const actionColors = {
        'Created': '#2563eb', 'Updated': '#1d1d1f', 'Published': '#059669',
        'Unpublished': '#d97706', 'Archived': '#7c3aed', 'Restored': '#059669', 'Deleted': '#dc2626',
    };
    const actionIcons = {
        'Created': 'ph-plus-circle', 'Updated': 'ph-pencil-simple', 'Published': 'ph-rocket-launch',
        'Unpublished': 'ph-arrow-line-down', 'Archived': 'ph-archive', 'Restored': 'ph-arrow-counter-clockwise', 'Deleted': 'ph-trash',
    };
    return `
        <div class="product-history-section" style="border-top:1px solid var(--border-light);margin-top:32px;padding-top:32px">
            <div style="font-size:11px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:16px">History</div>
            <div style="display:flex;flex-direction:column;gap:0;position:relative;padding-left:20px">
                <div style="position:absolute;left:7px;top:6px;bottom:6px;width:1px;background:var(--border-light)"></div>
                ${p.history.map((h, i) => {
                    const color = actionColors[h.action] || '#86868b';
                    const icon = actionIcons[h.action] || 'ph-info';
                    const d = new Date(h.timestamp);
                    const timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const hidden = i >= HISTORY_PAGE_SIZE;
                    return `<div class="history-entry${hidden ? ' history-entry-hidden' : ''}" style="display:${hidden ? 'none' : 'flex'};align-items:flex-start;gap:12px;padding:8px 0;position:relative">
                        <div style="position:absolute;left:-20px;top:10px;width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid ${color};display:flex;align-items:center;justify-content:center;z-index:1"><i class="ph ${icon}" style="font-size:8px;color:${color}"></i></div>
                        <div style="flex:1;min-width:0">
                            <div style="font-size:13px;font-weight:600;color:${color}">${esc(h.action)}${h.detail ? ' <span style="font-weight:400;color:#86868b">· ' + esc(h.detail) + '</span>' : ''}</div>
                            <div style="font-size:11px;color:#c7c7cc;margin-top:2px">${esc(h.user || 'System')} · ${timeStr}</div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            ${p.history.length > HISTORY_PAGE_SIZE ? `
            <div style="margin-top:12px;padding-left:20px">
                <button type="button" class="btn-ghost" style="font-size:12px" onclick="showMoreProductHistory(this)"><i class="ph ph-caret-down"></i> More (${p.history.length - HISTORY_PAGE_SIZE})</button>
            </div>` : ''}
        </div>`;
}

function showMoreProductHistory(btn) {
    const root = btn.closest('.product-history-section');
    if (!root) return;
    root.querySelectorAll('.history-entry-hidden').forEach(el => {
        el.classList.remove('history-entry-hidden');
        el.style.display = 'flex';
    });
    btn.parentElement.remove();
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG (global)
// ═══════════════════════════════════════════════════════════════════

function renderActivityLog() {
    const target = document.getElementById('activity-log-list');
    if (!target) return;
    if (!ACTIVITY_LOG.length) {
        target.innerHTML = `<div style="padding:32px 0">${emptyState(
            'ph-clock-counter-clockwise',
            EMPTY_STATE_NO_DATA,
            '<div style="font-size:12px;color:#c7c7cc;margin-top:4px">Actions like publish, archive, and delete will appear here.</div>'
        )}</div>`;
        return;
    }
    const actionIcons = {
        'Published': { icon: 'ph-rocket-launch', color: '#059669', bg: '#ecfdf5' },
        'Unpublished': { icon: 'ph-arrow-line-down', color: '#d97706', bg: '#fff7ed' },
        'Archived': { icon: 'ph-archive', color: '#7c3aed', bg: '#f3f0ff' },
        'Restored': { icon: 'ph-arrow-counter-clockwise', color: '#059669', bg: '#ecfdf5' },
        'Deleted': { icon: 'ph-trash', color: '#dc2626', bg: '#fef2f2' },
        'Created': { icon: 'ph-plus-circle', color: '#2563eb', bg: '#eff6ff' },
        'Updated': { icon: 'ph-pencil-simple', color: '#1d1d1f', bg: '#f5f5f7' },
    };
    target.innerHTML = `<div style="border:1px solid var(--border-light);border-radius:12px;overflow:hidden">${ACTIVITY_LOG.map((log, i) => {
        const a = actionIcons[log.action] || { icon: 'ph-info', color: '#86868b', bg: '#f5f5f7' };
        const time = new Date(log.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;${i < ACTIVITY_LOG.length - 1 ? 'border-bottom:1px solid var(--border-light)' : ''};background:${i % 2 === 0 ? '#fff' : '#fafbfc'}">
            <div style="width:34px;height:34px;border-radius:10px;background:${a.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ph ${a.icon}" style="font-size:16px;color:${a.color}"></i></div>
            <div style="flex:1;min-width:0">
                <div style="font-size:13.5px;font-weight:600;color:#1d1d1f"><span style="color:${a.color}">${esc(log.action)}</span> · ${esc(log.productName)}</div>
                ${log.detail ? `<div style="font-size:12px;color:#86868b;margin-top:1px">${esc(log.detail)}</div>` : ''}
            </div>
            <div style="font-size:11px;color:#c7c7cc;font-weight:500;flex-shrink:0;font-variant-numeric:tabular-nums">${timeStr}</div>
        </div>`;
    }).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

// Keyboard shortcuts
function toggleUserMenu(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('user-menu-dropdown');
    const caret = document.getElementById('user-menu-caret');
    if (!dd) return;
    const open = dd.style.display !== 'block';
    dd.style.display = open ? 'block' : 'none';
    if (caret) caret.style.transform = open ? 'rotate(180deg)' : '';
}
function closeUserMenu() {
    const dd = document.getElementById('user-menu-dropdown');
    const caret = document.getElementById('user-menu-caret');
    if (dd) dd.style.display = 'none';
    if (caret) caret.style.transform = '';
}

// Close the account menu on outside click / Escape
document.addEventListener('click', e => {
    if (!e.target.closest('#user-menu-btn') && !e.target.closest('#user-menu-dropdown')) closeUserMenu();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (document.getElementById('product-icon-crop-root')?.innerHTML) closeProductIconCropper();
        else if (document.getElementById('user-menu-dropdown')?.style.display === 'block') closeUserMenu();
        else if (sdBackdrop?.classList.contains('is-open')) closeSwPreview();
        else if (document.getElementById('modal-root').innerHTML) closeModal();
    }
});

initPortal();
