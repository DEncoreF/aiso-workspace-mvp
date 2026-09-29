// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let portalMutationDepth = 0;

function logActivity(action, productName, detail = '', pid = null) {
    const ts = new Date().toISOString();
    const entry = { action, productName, detail, timestamp: ts, user: currentUser?.name || 'System', org_id: activeOrgId() };
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
        ORDERS,
        ORDER_LINES,
        TICKETS,
        TICKET_MESSAGES,
        NOTIFICATIONS,
        ORGS,
        USERS,
        ROLES,
        ROLE_BINDINGS,
        ACTIVITY_LOG,
        HARDWARE_PRODUCT_TYPES,
        SOFTWARE_CATEGORY_OPTIONS,
        SOFTWARE_INDUSTRY_OPTIONS,
    }));
}

function restorePortalState(snapshot) {
    PRODUCTS = snapshot.PRODUCTS;
    ORDERS = snapshot.ORDERS;
    ORDER_LINES = snapshot.ORDER_LINES;
    TICKETS = snapshot.TICKETS;
    TICKET_MESSAGES = snapshot.TICKET_MESSAGES;
    NOTIFICATIONS = snapshot.NOTIFICATIONS;
    ORGS = snapshot.ORGS;
    USERS = snapshot.USERS;
    ROLES = snapshot.ROLES;
    ROLE_BINDINGS = snapshot.ROLE_BINDINGS;
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

// Permission strings are `<module>.<c|r|u|d>` (PERMISSION_MODULES in seed-data.js).
const PORTAL_PERMISSIONS = Object.freeze({
    COMPATIBILITY_READ: 'compatibility.r',
    COMPATIBILITY_UPDATE: 'compatibility.u',
    COMPATIBILITY_AUDIT_READ: 'compatibility.r',
    ASSET_READ: 'asset.r',
    ASSET_UPDATE: 'asset.u',
    ORDER_READ: 'order.r',
    ORDER_CREATE: 'order.c',
    ORDER_UPDATE: 'order.u',
    TICKET_READ: 'ticket.r',
    TICKET_CREATE: 'ticket.c',
    TICKET_UPDATE: 'ticket.u',
    PARAMETER_UPDATE: 'parameter.u',
});

// ── Access context (docs/ORG_MANAGEMENT_PLAN.md) ──
// Who is acting: the signed-in account plus the one role in effect. Grants are
// never merged across roles — switching role is how the view changes.
// The Super Admin holds no role and passes every check, but can view as any
// member (bottom-right switch): that person's role grants and org then apply
// exactly, and person-level things like notifications are theirs.
let activeBindingId = null;  // the regular account's role binding in effect
let viewAsBindingId = null;  // Super Admin only: the member (user × role) being viewed as

function activeBinding() {
    return ROLE_BINDINGS.find(b => b.id === (viewAsBindingId || activeBindingId)) || null;
}
function activeRole() {
    const binding = activeBinding();
    return binding ? ROLES.find(r => r.id === binding.role_id) || null : null;
}
// The person acting: the viewed-as member, or the signed-in account. The
// Super Admin in its own context belongs to no org, so it is nobody's colleague.
function actingUser() {
    if (viewAsBindingId) return USERS.find(u => u.id === activeBinding()?.user_id) || null;
    return currentUser?.is_super_admin ? null : currentUser;
}
function activeOrg() { const role = activeRole(); return role ? getOrgById(role.org_id) : null; }
function activeOrgId() { return activeOrg()?.id || null; }
function isSuperAdminContext() { return !!currentUser?.is_super_admin && !viewAsBindingId; }
function orgHasType(org, type) { return !!org?.types?.includes(type) && ENABLED_ORG_TYPES.includes(type); }
// Desk-only affordances (internal notes, status changes, unlinked-org fixes)
// follow the org type, not a grant: a customer role never gets them.
function isOperatorView() { return isSuperAdminContext() || orgHasType(activeOrg(), 'OPERATOR'); }
function isCustomerView() { return !isOperatorView() && orgHasType(activeOrg(), 'CUSTOMER'); }
// The name messages go out under: whoever is acting, viewed-as or signed in.
function actingName() { return actingUser()?.name || currentUser?.name || ''; }

// What one type contributes to an org's ceiling. CUSTOMER resolves further by
// customer_type: an individual customer is one person, so nothing about
// organization management is on offer.
function typeCapabilities(org, type) {
    if (type !== 'CUSTOMER') return ORG_TYPE_CAPABILITIES[type] || {};
    return CUSTOMER_TYPE_CAPABILITIES[org?.customer_type] || CUSTOMER_TYPE_CAPABILITIES.ENTERPRISE;
}

// Layer 1 ceiling for an org: the union over its enabled types.
function orgCapabilities(org) {
    const allowed = new Set();
    (org?.types || []).filter(t => ENABLED_ORG_TYPES.includes(t)).forEach(t => {
        Object.entries(typeCapabilities(org, t)).forEach(([mod, actions]) =>
            [...actions].forEach(a => allowed.add(`${mod}.${a}`)));
    });
    return allowed;
}
// A role's grants, clipped to its org's ceiling — so narrowing an org's type
// can never leave a role holding more than the type allows.
function effectivePermissions(role) {
    const ceiling = orgCapabilities(getOrgById(role?.org_id));
    return (role?.permissions || []).filter(p => ceiling.has(p));
}

// Central permission boundary: every check in the app goes through here.
function hasPermission(permission) {
    if (isSuperAdminContext()) return true;
    const role = activeRole();
    return !!role && effectivePermissions(role).includes(permission);
}

function canViewCompatibility() { return hasPermission(PORTAL_PERMISSIONS.COMPATIBILITY_READ); }
function canViewAssets() { return hasPermission(PORTAL_PERMISSIONS.ASSET_READ); }
function canManageAssets() { return hasPermission(PORTAL_PERMISSIONS.ASSET_UPDATE); }
function canManageCompatibility() { return hasPermission(PORTAL_PERMISSIONS.COMPATIBILITY_UPDATE); }
function canViewTickets() { return hasPermission(PORTAL_PERMISSIONS.TICKET_READ); }
function canCreateTickets() { return hasPermission(PORTAL_PERMISSIONS.TICKET_CREATE); }
// Managing a ticket (status, internal notes, replying as AISO) is desk work.
function canManageTickets() { return isOperatorView() && hasPermission(PORTAL_PERMISSIONS.TICKET_UPDATE); }
function canReplyTickets() { return hasPermission(PORTAL_PERMISSIONS.TICKET_UPDATE); }
function canCreateOrders() { return hasPermission(PORTAL_PERMISSIONS.ORDER_CREATE); }
function canUpdateOrders() { return hasPermission(PORTAL_PERMISSIONS.ORDER_UPDATE); }
function productModule(type) { return type === 'software' ? 'sw_product' : 'hw_product'; }
function canCreateProduct(type) { return hasPermission(`${productModule(type)}.c`); }
function canManageProduct(p) { return hasPermission(`${productModule(p?.product_type)}.u`); }
function canDeleteProduct(p) { return hasPermission(`${productModule(p?.product_type)}.d`); }
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

// size: 'md' | 'lg' | 'wide' | 'edit'. A modal is sized to its content, not
// squeezed into the default width — forms with two columns, tables and detail
// views all need the room.
const MODAL_SIZE_CLASS = { md: 'modal-md', lg: 'modal-lg', wide: 'modal-wide', edit: 'modal-edit' };

function showModal(html, size = false) {
    const root = document.getElementById('modal-root');
    const modalClass = size === true ? 'modal-wide' : (MODAL_SIZE_CLASS[size] || '');
    root.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal-card ${modalClass}">${html}</div></div>`;
    document.body.classList.add('modal-open');
}

function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    document.body.classList.remove('modal-open');
}

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
    // Link orders and tickets to customer orgs by name before anything reads them.
    if (backfillCustomerOrgIds()) Store.save({ notify: false });
    // Keep the user signed in across reloads (cleared on Logout or tab close),
    // as long as the account and its role are still usable.
    const session = readSession();
    const user = session && USERS.find(u => u.id === session.user_id && u.status === 'active');
    if (user?.is_super_admin) { enterApp(user); return; }
    if (user && usableBindings(user.id).some(b => b.id === session.binding_id)) { enterApp(user, session.binding_id); return; }
    clearSession();
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

// ── Sign-in (docs/ORG_MANAGEMENT_PLAN.md, flow A) ──
// Prototype: every account shares the demo password; nothing is hashed.
// The session holds only who signed in and which role is in effect.

const SESSION_KEY = 'aiso-portal-auth';

function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user_id: currentUser.id, binding_id: activeBindingId })); } catch (e) {}
}
function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

function findUserByEmail(email) {
    const target = String(email || '').trim().toLowerCase();
    return USERS.find(u => u.email.toLowerCase() === target) || null;
}

// Bindings an account can act under: the binding is active, its role still
// exists, and the role's org is active and of a type enabled this round.
function usableBindings(userId) {
    return ROLE_BINDINGS.filter(b => {
        if (b.user_id !== userId || b.status !== 'active') return false;
        const role = ROLES.find(r => r.id === b.role_id);
        const org = role && getOrgById(role.org_id);
        return !!org && org.status === 'active' && org.types.some(t => ENABLED_ORG_TYPES.includes(t));
    });
}
function bindingParts(binding) {
    const role = ROLES.find(r => r.id === binding?.role_id) || null;
    return { role, org: role ? getOrgById(role.org_id) : null };
}

function setLoginFormError(message) {
    const el = document.getElementById('login-form-error');
    if (el) { el.textContent = message || ''; el.style.display = message ? 'block' : 'none'; }
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
    const user = findUserByEmail(email);
    setLoginFormError('');
    if (!user || password !== DEMO_LOGIN.password) {
        const incorrect = 'The Email or Password you entered is incorrect.';
        if (emailEl) emailEl.classList.add('field-error');
        if (pwEl) pwEl.classList.add('field-error');
        if (emailErr) emailErr.textContent = incorrect;
        if (pwErr) pwErr.textContent = incorrect;
        return;
    }
    if (emailErr) emailErr.textContent = '';
    if (pwErr) pwErr.textContent = '';
    if (emailEl) emailEl.classList.remove('field-error');
    if (pwEl) pwEl.classList.remove('field-error');

    // The credentials are right past this point, so each refusal says what
    // an admin has to fix rather than repeating "incorrect".
    if (user.status !== 'active') {
        setLoginFormError('This account is disabled. Ask your organization admin to re-enable it.');
        return;
    }
    if (user.is_super_admin) { enterApp(user); return; }
    const bindings = usableBindings(user.id);
    if (!bindings.length) {
        setLoginFormError('This account has no role yet. Ask your organization admin to assign one.');
        return;
    }
    if (bindings.length === 1) { enterApp(user, bindings[0].id); return; }
    showLoginRolePicker(user, bindings);
}

// More than one role: pick which one to sign in under. The sidebar account
// menu switches later without signing in again.
function showLoginRolePicker(user, bindings) {
    const form = document.getElementById('login-form-panel');
    const picker = document.getElementById('login-role-picker');
    if (!form || !picker) return;
    form.style.display = 'none';
    picker.style.display = 'block';
    picker.innerHTML = `
        <div style="font-size:1.05rem;font-weight:700;color:#1d1d1f">Choose a role</div>
        <div style="font-size:13px;color:#86868b;margin:4px 0 16px">${esc(user.email)} holds ${bindings.length} roles. You can switch later from the account menu.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
            ${bindings.map(b => {
                const { role, org } = bindingParts(b);
                return `<button type="button" onclick="pickLoginRole('${user.id}', '${b.id}')" class="login-role-option" style="display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#fff;cursor:pointer;text-align:left">
                    <i class="ph ${orgHasType(org, 'OPERATOR') ? 'ph-shield' : 'ph-buildings'}" style="font-size:20px;color:#1432E6"></i>
                    <span style="flex:1;min-width:0">
                        <span style="display:block;font-size:13.5px;font-weight:600;color:#1d1d1f">${esc(org?.name || '')}</span>
                        <span style="display:block;font-size:12px;color:#86868b">${esc(role?.name || '')}</span>
                    </span>
                    <span class="badge ${orgHasType(org, 'OPERATOR') ? 'badge-blue' : 'badge-customer'}">${orgHasType(org, 'OPERATOR') ? 'Operator' : 'Customer'}</span>
                </button>`;
            }).join('')}
        </div>
        <div style="text-align:center;margin-top:16px">
            <a href="#" onclick="event.preventDefault();resetLoginPanel()" style="color:#1432E6;font-size:12px;font-weight:600;text-decoration:none">Use another account</a>
        </div>`;
}

function pickLoginRole(userId, bindingId) {
    const user = USERS.find(u => u.id === userId);
    if (!user || !usableBindings(userId).some(b => b.id === bindingId)) { resetLoginPanel(); return; }
    enterApp(user, bindingId);
}

function resetLoginPanel() {
    const form = document.getElementById('login-form-panel');
    const picker = document.getElementById('login-role-picker');
    if (form) form.style.display = '';
    if (picker) { picker.style.display = 'none'; picker.innerHTML = ''; }
    setLoginFormError('');
}

function enterApp(user, bindingId = null) {
    currentUser = { ...user, label: user.is_super_admin ? 'Super Admin' : '' };
    activeBindingId = user.is_super_admin ? null : bindingId;
    viewAsBindingId = null;
    saveSession();
    if (typeof closeUserMenu === 'function') closeUserMenu();
    const screen = document.getElementById('login-screen');
    if (screen) screen.style.display = 'none';
    resetLoginPanel();

    renderSidebarUser();
    renderUserMenu();
    buildNav();
    renderViewAsSwitch();

    // Settings has no permission, so there is always a first view.
    navigate(visibleNavItems()[0].key);
}

// The account menu lists every role the account can act under; picking one
// only changes the role in effect — no second sign-in.
function renderUserMenu() {
    const dd = document.getElementById('user-menu-dropdown');
    if (!dd || !currentUser) return;
    const row = (icon, title, sub, active, onclick) => `
        <${onclick ? `button type="button" onclick="${onclick}"` : 'div'} style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:8px;border:none;text-align:left;cursor:${onclick ? 'pointer' : 'default'};background:${active ? '#eef1ff' : 'transparent'}">
            <i class="ph ${icon}" style="font-size:18px;color:${active ? '#1432E6' : '#86868b'}"></i>
            <span style="flex:1;min-width:0">
                <span style="display:block;font-size:13px;font-weight:600;color:${active ? '#1432E6' : '#1d1d1f'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</span>
                ${sub ? `<span style="display:block;font-size:11.5px;color:#86868b">${esc(sub)}</span>` : ''}
            </span>
            ${active ? '<i class="ph ph-check" style="font-size:15px;color:#1432E6"></i>' : ''}
        </${onclick ? 'button' : 'div'}>`;
    if (currentUser.is_super_admin) {
        dd.innerHTML = `<div style="font-size:10px;color:#c7c7cc;text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 4px">Role</div>
            ${row('ph-shield-check', 'Super Admin', 'Preview any role with View as, bottom right', true, '')}`;
        return;
    }
    const bindings = usableBindings(currentUser.id);
    dd.innerHTML = `<div style="font-size:10px;color:#c7c7cc;text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 4px">${bindings.length > 1 ? 'Switch role' : 'Role'}</div>
        ${bindings.map(b => {
            const { role, org } = bindingParts(b);
            const active = b.id === activeBindingId;
            return row(orgHasType(org, 'OPERATOR') ? 'ph-shield' : 'ph-buildings', org?.name || '', role?.name || '', active,
                active || bindings.length < 2 ? '' : `switchRole('${b.id}')`);
        }).join('')}`;
}

function switchRole(bindingId) {
    if (!currentUser || !usableBindings(currentUser.id).some(b => b.id === bindingId)) return;
    // Staged Parameter Center / Compatibility edits belong to the role that
    // made them, so they must be settled before the role changes.
    if (getDirtyScope()) {
        closeUserMenu();
        showToast('Save or discard your staged changes before switching role.', 'error');
        return;
    }
    activeBindingId = bindingId;
    saveSession();
    closeUserMenu();
    closeModal();
    renderSidebarUser();
    renderUserMenu();
    buildNav();
    const allowed = visibleNavItems().map(n => n.key);
    navigate(allowed.includes(currentView) ? currentView : allowed[0]);
    const { role, org } = bindingParts(ROLE_BINDINGS.find(b => b.id === bindingId));
    showToast(`Switched to ${org?.name} · ${role?.name}`, 'info');
}

function visibleNavItems() {
    return NAV_ITEMS.filter(n => !n.permission || hasPermission(n.permission));
}

function buildNav() {
    const navEl = document.getElementById('dynamic-nav');
    navEl.innerHTML = visibleNavItems().map(n => `
        <button class="nav-item" data-nav="${n.key}" onclick="navigate('${n.key}')">
            <span class="nav-icon"><i class="ph ${n.icon}"></i></span>
            <span>${esc(n.label)}</span>
        </button>
    `).join('');
}

// The sidebar card shows whoever the desk is currently acting as.
function renderSidebarUser() {
    const role = activeRole();
    const name = actingName();
    const label = role ? `${activeOrg()?.name || ''} · ${role.name}` : currentUser.label;
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-role').textContent = viewAsBindingId ? `Viewing as · ${label}` : label;
    document.getElementById('user-avatar').textContent = getUserInitials(name);
}

function logout() {
    clearSession();
    closeModal();
    if (typeof closeSwPreview === 'function') closeSwPreview();
    if (typeof closeUserMenu === 'function') closeUserMenu();
    // Staged edits never survive a session.
    paramDraft = null;
    compatDraft = null;
    viewAsBindingId = null;
    activeBindingId = null;
    const vaRoot = document.getElementById('view-as-root');
    if (vaRoot) vaRoot.innerHTML = '';
    notifMenuOpen = false;
    const notifRoot = document.getElementById('notif-root');
    if (notifRoot) notifRoot.innerHTML = '';
    currentUser = null;
    resetLoginPanel();
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
    // Asset Registry is off the nav while hidden but still guarded.
    const guard = NAV_ITEMS.find(n => n.key === key)?.permission || (key === 'assets' ? PORTAL_PERMISSIONS.ASSET_READ : null);
    if (guard && !hasPermission(guard)) {
        showToast('You do not have permission to view this page.', 'error');
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
        'sw-products': { title: 'Software Products', action: canCreateProduct('software') ? `<button onclick="showCreateProductModal('software')" class="btn-primary" id="sw-create-btn"><i class="ph ph-plus"></i> Add Software</button>` : '' },
        'hw-products': { title: 'Hardware Products', action: canCreateProduct('hardware') ? `<button onclick="showCreateProductModal('hardware')" class="btn-primary" id="hw-create-btn"><i class="ph ph-plus"></i> Add Hardware</button>` : '' },
        'orders': isCustomerView() ? {
            title: 'Orders',
            subtitle: `Confirmed orders for ${activeOrg()?.name || ''}. Open a service ticket from any order line.`,
        } : {
            title: 'Orders',
            subtitle: 'Purchase orders from customers. Names are free text; a customer name links to its organization when they match.',
            action: canCreateOrders() ? `<div style="white-space:nowrap"><button onclick="showOrderModal()" class="btn-primary"><i class="ph ph-plus"></i> New Order</button></div>` : ''
        },
        'service-desk': {
            title: 'Service Desk',
            subtitle: isCustomerView()
                ? `Service requests for ${activeOrg()?.name || ''}. Each ticket is tied to one order line.`
                : 'After-sales requests against confirmed orders. AISO is the single service window.',
            action: serviceDeskPageAction(),
        },
        'assets': {
            title: 'Asset Registry',
            subtitle: 'Serial numbers and warranty for AISO-built devices. Serials are produced by the manufacturing team and imported here; partner hardware is warranted by its own vendor and is not listed.',
            action: `<div class="flex items-center gap-2" style="white-space:nowrap">
                ${hasPermission('asset.c') ? `<button onclick="showAssetAddModal()" class="btn-secondary" title="Add one device by hand"><i class="ph ph-plus"></i> Add</button>` : ''}
                ${isOperatorView() ? `<button onclick="exportAssetsForPortal()" class="btn-secondary" title="Download warranty-data.js for the Portal"><i class="ph ph-download-simple"></i> Export</button>` : ''}
                ${hasPermission('asset.c') ? `<button onclick="showAssetImportModal()" class="btn-primary"><i class="ph ph-upload-simple"></i> Import</button>` : ''}
            </div>`
        },
        'organizations': {
            title: 'Organizations',
            subtitle: isOperatorView()
                ? 'AISO and customer organizations, their members and roles. Each type sets what its roles can be granted.'
                : 'Your organization, its members and roles.',
            action: canCreateOrgs() ? `<div style="white-space:nowrap"><button onclick="showOrgModal()" class="btn-primary"><i class="ph ph-plus"></i> New Organization</button></div>` : '',
        },
        'compatibility': { title: 'Compatibility Mapping', subtitle: 'Manage which published hardware products can be paired with each published software product. Edits are staged until you save them.' },
        'param-center': { title: 'Parameter Center', subtitle: hasPermission(PORTAL_PERMISSIONS.PARAMETER_UPDATE) ? 'System-level parameters. Edits are staged until you save them.' : 'System-level parameters. Your role can view them but not save changes.' },
        // Clearing the shared log is Super Admin only; no role grant reaches it.
        'activity-log': { title: 'Activity Log', subtitle: 'Recent actions performed in this session.', action: isSuperAdminContext() ? `<button onclick="ACTIVITY_LOG=[];Store.save();renderActivityLog();showToast('Log cleared')" class="btn-secondary"><i class="ph ph-trash"></i> Clear</button>` : '' },
        'settings': { title: 'Settings' },
    }[key] || {};
    setPageHeader(meta.title || '', meta.subtitle || '', meta.action || '');

    // Render
    if (key === 'sw-products') renderSwProducts();
    else if (key === 'hw-products') renderHwProducts();
    else if (key === 'orders') renderOrders();
    else if (key === 'service-desk') renderServiceDesk();
    if (key !== 'service-desk') renderNotificationBell();
    else if (key === 'assets') renderAssets();
    else if (key === 'organizations') renderOrganizations();
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
    if (!canManageProduct(p)) { showToast('Your role cannot change this product.', 'error'); return; }
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
    if (!canDeleteProduct(p)) { showToast('Your role cannot delete products.', 'error'); return; }
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
    const kind = String(vendorType || '').toUpperCase();
    const org = ORGS.find(o => o.types?.includes('VENDOR') && o.vendor_type === kind && o.name.toLowerCase() === target);
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
    if (!canCreateProduct(type)) { showToast('Your role cannot create products.', 'error'); return; }
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
    if (scope === 'param-center' && !hasPermission(PORTAL_PERMISSIONS.PARAMETER_UPDATE)) {
        showToast('Your role can view parameters but not save changes.', 'error');
        return;
    }
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
        </div>`, 'md');
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
    const role = activeRole();
    document.getElementById('settings-role').value = isSuperAdminContext()
        ? 'Super Admin (unrestricted cross-org access)'
        : `${activeOrg()?.name || ''} · ${role?.name || ''}${viewAsBindingId ? ' (viewing as)' : ''}`;
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

// The desk sees the whole log; anyone else only what their own org did.
function getVisibleActivityLog() {
    if (isOperatorView()) return ACTIVITY_LOG;
    const orgId = activeOrgId();
    return ACTIVITY_LOG.filter(log => orgId && log.org_id === orgId);
}

function renderActivityLog() {
    const target = document.getElementById('activity-log-list');
    if (!target) return;
    const visibleLog = getVisibleActivityLog();
    if (!visibleLog.length) {
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
    target.innerHTML = `<div style="border:1px solid var(--border-light);border-radius:12px;overflow:hidden">${visibleLog.map((log, i) => {
        const a = actionIcons[log.action] || { icon: 'ph-info', color: '#86868b', bg: '#f5f5f7' };
        const time = new Date(log.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;${i < visibleLog.length - 1 ? 'border-bottom:1px solid var(--border-light)' : ''};background:${i % 2 === 0 ? '#fff' : '#fafbfc'}">
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

// ═══════════════════════════════════════════════════════════════════
// ASSET REGISTRY
//
// One row per AISO-built device. Serial numbers come from the manufacturing
// team as CSV; nothing here issues them.
//
// Only own-brand products get devices. Partner hardware is warranted by its own
// vendor, so it never enters this registry -- its serials live on order lines
// instead. That is why importOwnBrandOnly() rejects a partner model outright
// rather than quietly accepting it.
// ═══════════════════════════════════════════════════════════════════

const ASSET_PAGE_SIZE = 10;
let assetPage = 1;
let assetSort = { field: 'serial_no', dir: 'asc' };

function resetAssetPage() { assetPage = 1; }

function setAssetPage(page) {
    const next = Number.parseInt(page, 10);
    if (!Number.isFinite(next)) return;
    assetPage = Math.max(1, next);
    renderAssets();
}

function setAssetFilter(val) {
    document.getElementById('asset-filter-status').value = val;
    document.querySelectorAll('#asset-filter-tabs .filter-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
    });
    resetAssetPage();
    renderAssets();
}

function toggleAssetSort(field) {
    if (assetSort.field === field) assetSort.dir = assetSort.dir === 'asc' ? 'desc' : 'asc';
    else assetSort = { field, dir: 'asc' };
    renderAssets();
}

// ── Own-brand lookup ──

function isOwnBrandProduct(p) { return !!(p && p.is_own_brand); }

function getOwnBrandProducts() {
    return PRODUCTS.filter(p => p.product_type === 'hardware' && isOwnBrandProduct(p));
}

// Manufacturing sends the model string a human reads off the label, not our
// internal id, so imports resolve on `model` and fall back to the product name.
function findOwnBrandProductByModel(model) {
    const target = String(model || '').trim().toLowerCase();
    if (!target) return null;
    return getOwnBrandProducts().find(p =>
        String(p.model || '').toLowerCase() === target ||
        String(p.name || '').toLowerCase() === target
    ) || null;
}

function getAssetProduct(asset) {
    return PRODUCTS.find(p => p.id === asset.product_id) || null;
}

function getAssetProductName(asset) {
    const p = getAssetProduct(asset);
    return p ? p.name : asset.product_id;
}

// ── Warranty ──

function addMonthsToDate(iso, months) {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + Number(months || 0));
    // Rolling 31 Jan forward by one month lands in March unless we pull it back.
    if (d.getDate() !== day) d.setDate(0);
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
}

function toIsoDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysUntil(iso) {
    const end = new Date(iso + 'T00:00:00');
    if (Number.isNaN(end.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
}

function getWarrantyState(asset) {
    const left = daysUntil(asset.warranty_end);
    if (left === null) return { key: 'unknown', label: 'Unknown', days: null };
    if (left < 0) return { key: 'expired', label: 'Out of warranty', days: left };
    if (left <= ASSET_EXPIRING_SOON_DAYS) return { key: 'expiring', label: 'Expiring soon', days: left };
    return { key: 'active', label: 'In warranty', days: left };
}

function warrantyBadge(asset) {
    const st = getWarrantyState(asset);
    const cls = { active: 'badge-green', expiring: 'badge-amber', expired: 'badge-red', unknown: 'badge-zinc' }[st.key];
    return `<span class="badge ${cls}">${st.label}</span>`;
}

const WARRANTY_SOURCE_LABELS = {
    ship_date: 'Shipment date',
    invoice: 'Invoice date',
    manual: 'Set by AISO',
};

// The dates may only be recomputed from a shipment while nobody has overridden
// them; warranty_source is what records that someone did.
function warrantyIsDerived(asset) { return (asset.warranty_source || 'ship_date') === 'ship_date'; }

function getClaimOrgName(asset) {
    if (!asset.service_org_id) return null;
    const org = ORGS.find(o => o.id === asset.service_org_id);
    return org ? org.name : asset.service_org_id;
}

// ── List ──

function getFilteredAssets() {
    const q = (document.getElementById('asset-search')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('asset-filter-status')?.value || '';

    let list = getScopedAssets().filter(a => {
        if (filter === 'unclaimed' && a.service_org_id) return false;
        if (['active', 'expiring', 'expired'].includes(filter) && getWarrantyState(a).key !== filter) return false;
        if (q) {
            const hay = `${a.serial_no} ${getAssetProductName(a)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const dir = assetSort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) =>
        dir * String(a[assetSort.field] || '').localeCompare(String(b[assetSort.field] || '')));
}

// A customer sees the devices claimed by its own org; the desk sees all.
function getScopedAssets() {
    return isCustomerView() ? ASSETS.filter(a => a.service_org_id && a.service_org_id === activeOrgId()) : ASSETS;
}

function renderAssetStats() {
    const scoped = getScopedAssets();
    const total = scoped.length;
    const unclaimed = scoped.filter(a => !a.service_org_id).length;
    const expiring = scoped.filter(a => getWarrantyState(a).key === 'expiring').length;
    const expired = scoped.filter(a => getWarrantyState(a).key === 'expired').length;
    const chip = (label, val, color) =>
        `<div style="flex:1;background:#fafafa;border:1px solid #f0f0f0;border-radius:10px;padding:10px 14px">
            <div style="font-size:20px;font-weight:700;color:${color}">${val}</div>
            <div style="font-size:11px;color:#86868b;margin-top:1px">${label}</div>
        </div>`;
    document.getElementById('asset-stats-bar').innerHTML =
        chip('Devices', total, '#1d1d1f') +
        chip('Unclaimed', unclaimed, '#6b7280') +
        chip('Expiring soon', expiring, '#b45309') +
        chip('Out of warranty', expired, '#dc2626');
}

function renderAssets() {
    const list = getFilteredAssets();
    renderAssetStats();

    const totalPages = Math.max(1, Math.ceil(list.length / ASSET_PAGE_SIZE));
    assetPage = Math.min(Math.max(assetPage, 1), totalPages);
    const start = (assetPage - 1) * ASSET_PAGE_SIZE;
    const items = list.slice(start, start + ASSET_PAGE_SIZE);
    const searching = !!(document.getElementById('asset-search')?.value || '').trim();

    document.getElementById('assets-tbody').innerHTML = items.length ? items.map(a => {
        const st = getWarrantyState(a);
        const claimedBy = getClaimOrgName(a);
        return `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showAssetDetail('${a.id}')">
            <td><div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;font-size:13px;color:#1d1d1f">${esc(a.serial_no)}</div>
                <div style="font-size:11.5px;color:#86868b;margin-top:1px">Shipped ${esc(a.shipped_at || '—')}</div></td>
            <td><span style="font-size:13px;color:#1d1d1f">${esc(getAssetProductName(a))}</span></td>
            <td>${warrantyBadge(a)}</td>
            <td><div style="font-size:13px;color:#1d1d1f;font-variant-numeric:tabular-nums">${esc(a.warranty_end || '—')}</div>
                ${st.days !== null ? `<div style="font-size:11.5px;color:#86868b;margin-top:1px">${st.days < 0 ? `${Math.abs(st.days)}d ago` : `${st.days}d left`}</div>` : ''}</td>
            <td>${claimedBy
                ? `<span style="font-size:13px;color:#1d1d1f">${esc(claimedBy)}</span>`
                : '<span class="badge badge-zinc">Unclaimed</span>'}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <div class="flex items-center gap-0.5 justify-end">
                    <button onclick="showAssetDetail('${a.id}')" class="btn-ghost" title="Details"><i class="ph ph-info"></i></button>
                    ${a.service_org_id && isOperatorView() && canManageAssets() ? `<button onclick="confirmReleaseAsset('${a.id}')" class="btn-ghost" title="Release claim"><i class="ph ph-link-simple-break"></i></button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="6" class="text-center py-16">${emptyState(
        'ph-barcode',
        searching ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searching && hasPermission('asset.c') ? '<div class="flex items-center gap-2 justify-center mt-1"><button onclick="showAssetAddModal()" class="btn-secondary text-xs"><i class="ph ph-plus"></i> Add a device</button><button onclick="showAssetImportModal()" class="btn-primary text-xs"><i class="ph ph-upload-simple"></i> Import serials</button></div>' : ''
    )}</td></tr>`;

    renderAssetPagination(list.length, assetPage, totalPages);
}

function renderAssetPagination(totalItems, currentPage, totalPages) {
    const el = document.getElementById('assets-pagination');
    if (!el) return;
    if (totalItems <= ASSET_PAGE_SIZE) { el.innerHTML = ''; return; }
    const from = (currentPage - 1) * ASSET_PAGE_SIZE + 1;
    const to = Math.min(currentPage * ASSET_PAGE_SIZE, totalItems);
    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 4px;font-size:12.5px;color:#86868b">
            <span>Showing ${from}–${to} of ${totalItems}</span>
            <div class="flex items-center gap-1">
                <button class="btn-ghost" ${currentPage === 1 ? 'disabled' : ''} onclick="setAssetPage(${currentPage - 1})"><i class="ph ph-caret-left"></i></button>
                <span style="padding:0 8px">${currentPage} / ${totalPages}</span>
                <button class="btn-ghost" ${currentPage === totalPages ? 'disabled' : ''} onclick="setAssetPage(${currentPage + 1})"><i class="ph ph-caret-right"></i></button>
            </div>
        </div>`;
}

// ── Detail ──

function getAssetById(id) { return ASSETS.find(a => a.id === id) || null; }

function showAssetDetail(id) {
    const a = getAssetById(id);
    if (!a) return;
    const st = getWarrantyState(a);
    const claimedBy = getClaimOrgName(a);
    const derived = warrantyIsDerived(a);
    const row = (label, value) => `
        <div style="display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #f5f5f7">
            <span style="font-size:12.5px;color:#86868b">${label}</span>
            <span style="font-size:13px;color:#1d1d1f;text-align:right">${value}</span>
        </div>`;

    showModal(`
        <div style="padding:26px 28px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:6px">
                <div>
                    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;font-weight:700;color:#1d1d1f">${esc(a.serial_no)}</div>
                    <div style="font-size:13px;color:#86868b;margin-top:2px">${esc(getAssetProductName(a))}</div>
                </div>
                ${warrantyBadge(a)}
            </div>

            <div style="margin-top:16px">
                ${row('Shipped', esc(a.shipped_at || '—'))}
                ${row('Warranty starts', esc(a.warranty_start || '—'))}
                ${row('Warranty ends', esc(a.warranty_end || '—'))}
                ${row('Remaining', st.days === null ? '—' : (st.days < 0 ? `Ended ${Math.abs(st.days)} days ago` : `${st.days} days`))}
                ${row('Start date based on', esc(WARRANTY_SOURCE_LABELS[a.warranty_source] || a.warranty_source))}
                ${row('Claimed by', claimedBy ? esc(claimedBy) : '<span class="badge badge-zinc">Unclaimed</span>')}
                ${row('Claimed at', esc(a.claimed_at || '—'))}
                ${row('Source order', a.order_line_id ? esc(a.order_line_id) : '—')}
                ${row('Status', esc(a.status))}
            </div>

            ${derived ? '' : `<div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border-left:2px solid #b45309;border-radius:0 8px 8px 0;font-size:12.5px;color:#78350f">
                The start date was set by hand, so a re-import will leave it alone. The end date still follows the warranty term.
            </div>`}

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap">
                ${a.service_org_id && isOperatorView() && canManageAssets() ? `<button onclick="confirmReleaseAsset('${a.id}')" class="btn-secondary text-xs"><i class="ph ph-link-simple-break"></i> Release claim</button>` : ''}
                <button onclick="showWarrantyOverrideModal('${a.id}')" class="btn-secondary text-xs"><i class="ph ph-calendar-blank"></i> Adjust warranty start</button>
                <button onclick="closeModal()" class="btn-primary text-xs">Close</button>
            </div>
        </div>
    `, true);
}

// ── Release a claim ──
// Needed because registration only takes a serial number: a device claimed by
// the wrong person has to be recoverable, and a resold device has to be
// claimable again by its new owner.

function confirmReleaseAsset(id) {
    const a = getAssetById(id);
    if (!a || !a.service_org_id) return;
    const orgName = getClaimOrgName(a);
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">Release ${esc(a.serial_no)}?</h3>
            <p style="font-size:13px;color:#86868b;line-height:1.6;margin:0">
                ${esc(orgName)} will immediately lose sight of this device, and anyone holding it can register it again.
                The warranty is unaffected.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="closeModal()" class="btn-secondary text-xs">Cancel</button>
                <button onclick="releaseAsset('${a.id}')" class="btn-primary text-xs">Release claim</button>
            </div>
        </div>
    `);
}

function releaseAsset(id) {
    const a = getAssetById(id);
    if (!a || !a.service_org_id) return;
    const orgName = getClaimOrgName(a);
    a.service_org_id = null;
    a.claimed_at = null;
    a.updated_at = todayIso();
    if (!Store.save()) return;
    logActivity('Released', a.serial_no, `Claim by ${orgName} removed — device is unclaimed again`);
    closeModal();
    renderAssets();
    showToast(`${a.serial_no} released`);
}

// ── Warranty start override ──
// Coverage runs from the date of purchase. Shipment is only the default we fall
// back to when nobody has told us the real one.

function showWarrantyOverrideModal(id) {
    const a = getAssetById(id);
    if (!a) return;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Adjust warranty start</h3>
            <p style="font-size:12.5px;color:#86868b;line-height:1.6;margin:0 0 18px">
                ${esc(a.serial_no)} · currently ${esc(a.warranty_start)} → ${esc(a.warranty_end)}
                (${esc(WARRANTY_SOURCE_LABELS[a.warranty_source] || a.warranty_source)})
            </p>

            <label class="field-label">Start date</label>
            <input type="date" id="wov-start" class="input-field" value="${esc(a.warranty_start)}">

            <label class="field-label" style="margin-top:14px">Based on</label>
            <select id="wov-source" class="input-field">
                <option value="invoice" ${a.warranty_source === 'invoice' ? 'selected' : ''}>Invoice date — customer supplied proof of purchase</option>
                <option value="manual" ${a.warranty_source === 'manual' ? 'selected' : ''}>Set by AISO — goodwill, correction or extension</option>
                <option value="ship_date" ${a.warranty_source === 'ship_date' ? 'selected' : ''}>Shipment date — revert to the default</option>
            </select>

            <p style="font-size:12px;color:#86868b;line-height:1.6;margin-top:12px">
                The end date is recalculated from the ${a.warranty_months} month term, and keeps following it.
                Anything other than the shipment date also stops a re-import from moving this start date.
            </p>
            <p class="wov-error" id="wov-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin-top:10px"></p>

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="closeModal()" class="btn-secondary text-xs">Cancel</button>
                <button onclick="saveWarrantyOverride('${a.id}')" class="btn-primary text-xs">Save</button>
            </div>
        </div>
    `, 'md');
}

function saveWarrantyOverride(id) {
    const a = getAssetById(id);
    if (!a) return;
    const start = document.getElementById('wov-start').value;
    const source = document.getElementById('wov-source').value;
    const err = document.getElementById('wov-error');

    if (!start || Number.isNaN(new Date(start + 'T00:00:00').getTime())) {
        err.textContent = 'Enter a valid start date.';
        err.style.display = 'block';
        return;
    }

    const before = `${a.warranty_start} → ${a.warranty_end} (${a.warranty_source})`;
    a.warranty_start = start;
    a.warranty_end = addMonthsToDate(start, a.warranty_months);
    a.warranty_source = source;
    a.updated_at = todayIso();
    if (!Store.save()) return;

    logActivity('Warranty adjusted', a.serial_no, `${before} → ${a.warranty_start} → ${a.warranty_end} (${source})`);
    closeModal();
    renderAssets();
    showToast(`Warranty updated for ${a.serial_no}`);
}

function todayIso() { return toIsoDate(new Date()); }

// ═══════════════════════════════════════════════════════════════════
// ASSET IMPORT
//
// Rows are validated one by one and a run may partially succeed: one typo in a
// file of five hundred should not cost the other 499.
//
// An existing serial is updated, not duplicated, and the update touches only the
// columns manufacturing owns. Claims, order links and hand-set warranty dates
// belong to this side of the system and a re-import must not undo them.
// ═══════════════════════════════════════════════════════════════════

const ASSET_CSV_COLUMNS = ['serial_no', 'model', 'shipped_at', 'warranty_months'];

function parseAssetCsv(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { error: 'The file is empty.' };

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const missing = ASSET_CSV_COLUMNS.filter(c => !header.includes(c));
    if (missing.length) {
        return { error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected header: ${ASSET_CSV_COLUMNS.join(',')}` };
    }

    const rows = lines.slice(1).map((line, i) => {
        const cells = line.split(',').map(c => c.trim());
        const row = { _line: i + 2 };
        header.forEach((h, idx) => { row[h] = cells[idx] || ''; });
        return row;
    });
    return { rows };
}

function isIsoDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    return !Number.isNaN(new Date(v + 'T00:00:00').getTime());
}

function validateAssetRows(rows) {
    const seenInFile = new Map();
    return rows.map(row => {
        const serial = String(row.serial_no || '').trim().toUpperCase();
        const errors = [];

        if (!serial) errors.push('serial_no is empty');
        else if (seenInFile.has(serial)) errors.push(`serial_no repeats line ${seenInFile.get(serial)}`);
        else seenInFile.set(serial, row._line);

        const product = findOwnBrandProductByModel(row.model);
        if (!row.model) errors.push('model is empty');
        else if (!product) {
            // Being explicit here matters: a partner model is a legitimate product
            // that simply does not belong in this registry, and saying so saves
            // whoever is importing from hunting for a typo that isn't there.
            const anyProduct = PRODUCTS.find(p =>
                String(p.model || '').toLowerCase() === String(row.model).trim().toLowerCase() ||
                String(p.name || '').toLowerCase() === String(row.model).trim().toLowerCase());
            errors.push(anyProduct
                ? `${row.model} is partner hardware — the registry holds AISO-built devices only`
                : `no product matches model "${row.model}"`);
        }

        if (!isIsoDate(row.shipped_at)) errors.push('shipped_at must be YYYY-MM-DD');

        const months = Number(row.warranty_months);
        if (!Number.isInteger(months) || months <= 0) errors.push('warranty_months must be a positive whole number');

        const existing = ASSETS.find(a => a.serial_no === serial);
        return {
            line: row._line,
            serial_no: serial,
            model: row.model,
            shipped_at: row.shipped_at,
            warranty_months: months,
            product_id: product ? product.id : null,
            errors,
            ok: errors.length === 0,
            isUpdate: !!existing,
        };
    });
}

function applyAssetImport(validRows) {
    let created = 0, updated = 0, datesKept = 0;

    validRows.forEach(row => {
        const existing = ASSETS.find(a => a.serial_no === row.serial_no);

        if (!existing) {
            ASSETS.push({
                id: 'ast-' + Date.now().toString(36) + '-' + Math.floor(created + updated + 1),
                serial_no: row.serial_no,
                product_id: row.product_id,
                shipped_at: row.shipped_at,
                warranty_months: row.warranty_months,
                warranty_start: row.shipped_at,
                warranty_end: addMonthsToDate(row.shipped_at, row.warranty_months),
                warranty_source: 'ship_date',
                service_org_id: null,
                claimed_at: null,
                order_line_id: null,
                status: 'ACTIVE',
                replaced_by_asset_id: null,
                created_at: todayIso(),
                updated_at: todayIso(),
            });
            created++;
            return;
        }

        // Manufacturing-owned columns are refreshed.
        existing.product_id = row.product_id;
        existing.shipped_at = row.shipped_at;
        existing.warranty_months = row.warranty_months;

        // Only the start date is protected. An override says "coverage began on
        // this date", not "freeze the end date" -- so if manufacturing corrects
        // the term, the end has to move with it or the record contradicts itself:
        // 24 months on file, an end date still 36 months out.
        if (warrantyIsDerived(existing)) {
            existing.warranty_start = row.shipped_at;
        } else {
            datesKept++;
        }
        existing.warranty_end = addMonthsToDate(existing.warranty_start, row.warranty_months);

        // service_org_id, claimed_at, order_line_id, status and
        // replaced_by_asset_id are deliberately left untouched.
        existing.updated_at = todayIso();
        updated++;
    });

    return { created, updated, datesKept };
}

// ── Import UI ──

let assetImportPreview = null;

function showAssetImportModal() {
    assetImportPreview = null;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Import serial numbers</h3>
            <p style="font-size:12.5px;color:#86868b;line-height:1.6;margin:0 0 16px">
                Paste the list from the manufacturing team. AISO-built devices only — partner hardware is warranted by its own vendor and is rejected.
            </p>

            <label class="field-label">CSV</label>
            <textarea id="asset-csv" class="input-field" rows="8" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px"
                placeholder="${esc(ASSET_CSV_COLUMNS.join(','))}\nAISO1-2026-2001,AISO1,2026-08-01,36"></textarea>
            <p style="font-size:12px;color:#86868b;margin-top:8px">
                Header must be <code>${esc(ASSET_CSV_COLUMNS.join(','))}</code>. A serial already on file is updated, never duplicated.
            </p>

            <div id="asset-import-result" style="margin-top:16px"></div>

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="closeModal()" class="btn-secondary text-xs">Cancel</button>
                <button onclick="previewAssetImport()" class="btn-secondary text-xs" id="asset-preview-btn"><i class="ph ph-eye"></i> Check</button>
                <button onclick="commitAssetImport()" class="btn-primary text-xs" id="asset-commit-btn" disabled>Import</button>
            </div>
        </div>
    `, true);
}

function previewAssetImport() {
    const text = document.getElementById('asset-csv').value;
    const slot = document.getElementById('asset-import-result');
    const commit = document.getElementById('asset-commit-btn');
    assetImportPreview = null;
    commit.disabled = true;

    const parsed = parseAssetCsv(text);
    if (parsed.error) {
        slot.innerHTML = `<div style="padding:10px 12px;background:#fef2f2;border-left:2px solid #dc2626;border-radius:0 8px 8px 0;font-size:12.5px;color:#991b1b">${esc(parsed.error)}</div>`;
        return;
    }

    const rows = validateAssetRows(parsed.rows);
    const good = rows.filter(r => r.ok);
    const bad = rows.filter(r => !r.ok);
    assetImportPreview = good;
    commit.disabled = good.length === 0;

    const newCount = good.filter(r => !r.isUpdate).length;
    const updCount = good.length - newCount;

    slot.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:${bad.length ? '12px' : '0'}">
            <div style="flex:1;background:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;padding:9px 12px">
                <div style="font-size:17px;font-weight:700;color:#15803d">${good.length}</div>
                <div style="font-size:11.5px;color:#166534">ready — ${newCount} new, ${updCount} updated</div>
            </div>
            <div style="flex:1;background:${bad.length ? '#fef2f2' : '#fafafa'};border:1px solid ${bad.length ? '#fee2e2' : '#f0f0f0'};border-radius:8px;padding:9px 12px">
                <div style="font-size:17px;font-weight:700;color:${bad.length ? '#dc2626' : '#86868b'}">${bad.length}</div>
                <div style="font-size:11.5px;color:#86868b">rejected</div>
            </div>
        </div>
        ${bad.length ? `
        <div style="max-height:180px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px">
            <table class="data-table w-full" style="font-size:12.5px">
                <thead><tr><th style="width:14%">Line</th><th style="width:30%">Serial</th><th>Why it was rejected</th></tr></thead>
                <tbody>${bad.map(r => `
                    <tr><td style="font-variant-numeric:tabular-nums">${r.line}</td>
                        <td style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(r.serial_no || '—')}</td>
                        <td style="color:#991b1b">${esc(r.errors.join('; '))}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>
        <p style="font-size:12px;color:#86868b;margin-top:8px">The ready rows can still be imported; fix these and run the file again.</p>` : ''}
    `;
}

function commitAssetImport() {
    if (!assetImportPreview || !assetImportPreview.length) return;
    const res = applyAssetImport(assetImportPreview);
    if (!Store.save()) return;

    const parts = [`${res.created} added`, `${res.updated} updated`];
    if (res.datesKept) parts.push(`${res.datesKept} kept an adjusted start date`);
    logActivity('Imported', 'Asset registry', parts.join(', '));

    assetImportPreview = null;
    closeModal();
    resetAssetPage();
    renderAssets();
    showToast(`${res.created + res.updated} device${res.created + res.updated === 1 ? '' : 's'} imported`);
}

// ── Export for the Portal ──
// A format conversion, not a state export: only the manufacturing columns go
// out. Claims and order links stay here, so the Portal copy can never disagree
// with this one about anything it holds.

function exportAssetsForPortal() {
    const own = getOwnBrandProducts();
    const models = own.map(p => ({ code: p.model, name: p.name }));
    const assets = {};
    ASSETS.filter(a => a.status === 'ACTIVE').forEach(a => {
        const product = getAssetProduct(a);
        if (!product) return;
        assets[a.serial_no] = {
            model: product.model,
            shipped_at: a.shipped_at,
            warranty_start: a.warranty_start,
            warranty_end: a.warranty_end,
            warranty_source: a.warranty_source,
            claimed: !!a.service_org_id,
        };
    });

    const body = `/* Generated by portal-v4-mvp — Asset Registry export.
   Drop this into the Portal at hardware/v6/js/warranty-data.js.
   Manufacturing columns only: no customer, order or account data crosses over. */

window.AISO_WARRANTY = (function () {
  var MODELS = ${JSON.stringify(models, null, 2)};

  var ASSETS = ${JSON.stringify(assets, null, 2)};

  var EXPIRING_SOON_DAYS = ${ASSET_EXPIRING_SOON_DAYS};

  function modelName(code) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].code === code) return MODELS[i].name;
    return code;
  }
  function daysUntil(d) {
    var end = new Date(d + 'T00:00:00'), today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
  }
  function lookup(serial) {
    var key = String(serial || '').trim().toUpperCase();
    var a = ASSETS[key];
    if (!a) return null;
    var left = daysUntil(a.warranty_end);
    return {
      serial_no: key, model: a.model, product_name: modelName(a.model),
      shipped_at: a.shipped_at, warranty_start: a.warranty_start,
      warranty_end: a.warranty_end, warranty_source: a.warranty_source,
      claimed: a.claimed, days_left: left,
      state: left < 0 ? 'expired' : (left <= EXPIRING_SOON_DAYS ? 'expiring' : 'active')
    };
  }
  return { models: MODELS, modelName: modelName, lookup: lookup, EXPIRING_SOON_DAYS: EXPIRING_SOON_DAYS };
})();
`;

    const blob = new Blob([body], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'warranty-data.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${Object.keys(assets).length} devices for the Portal`);
}

// ── Add one device by hand ──
// Bulk import is how a production run arrives; this is for the single device
// that arrives outside one — a replacement unit, an engineering sample, a serial
// the manufacturing team sent through after the fact.
//
// It routes through the same validateAssetRows/applyAssetImport pair the import
// uses, so a serial typed here has to clear exactly the checks a pasted one
// does. Two entry points with two sets of rules is how a registry starts
// disagreeing with itself.

function showAssetAddModal() {
    const own = getOwnBrandProducts();
    if (!own.length) {
        showToast('No AISO-built products exist yet — mark one as own-brand first.', 'error');
        return;
    }

    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Add a device</h3>
            <p style="font-size:12.5px;color:#86868b;line-height:1.6;margin:0 0 18px">
                For a single unit. Use <button onclick="closeModal();showAssetImportModal()" style="background:none;border:0;padding:0;color:#1d1d1f;font-weight:600;text-decoration:underline;cursor:pointer;font-size:12.5px">Import</button> for a production run.
            </p>

            <label class="field-label" for="aa-serial">Serial number</label>
            <input type="text" id="aa-serial" class="input-field" autocomplete="off" spellcheck="false"
                   placeholder="AISO1-2026-2001" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">

            <label class="field-label" for="aa-model" style="margin-top:14px">Model</label>
            <select id="aa-model" class="input-field">
                ${own.map(p => `<option value="${esc(p.model)}">${esc(p.name)} (${esc(p.model)})</option>`).join('')}
            </select>

            <div style="display:flex;gap:12px;margin-top:14px">
                <div style="flex:1">
                    <label class="field-label" for="aa-shipped">Shipped</label>
                    <input type="date" id="aa-shipped" class="input-field" value="${todayIso()}">
                </div>
                <div style="flex:1">
                    <label class="field-label" for="aa-months">Warranty (months)</label>
                    <input type="number" id="aa-months" class="input-field" min="1" step="1" value="36">
                </div>
            </div>

            <p style="font-size:12px;color:#86868b;line-height:1.6;margin-top:12px">
                Coverage starts on the shipping date. Adjust it afterwards from the device if the customer supplies proof of purchase.
            </p>
            <p id="aa-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin-top:10px"></p>

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="closeModal()" class="btn-secondary text-xs">Cancel</button>
                <button onclick="saveAssetAdd()" class="btn-primary text-xs">Add device</button>
            </div>
        </div>
    `, 'md');

    setTimeout(() => document.getElementById('aa-serial')?.focus(), 50);
}

function saveAssetAdd() {
    const err = document.getElementById('aa-error');
    const fail = msg => { err.textContent = msg; err.style.display = 'block'; };

    const row = {
        _line: 1,
        serial_no: document.getElementById('aa-serial').value,
        model: document.getElementById('aa-model').value,
        shipped_at: document.getElementById('aa-shipped').value,
        warranty_months: document.getElementById('aa-months').value,
    };

    const [checked] = validateAssetRows([row]);
    if (!checked.ok) return fail(checked.errors.join('; '));

    // An existing serial would silently become an update here, which is not what
    // "Add" says it does. The import path is where a refresh belongs.
    if (checked.isUpdate) {
        return fail(`${checked.serial_no} is already on file. Open it from the list to change it, or use Import to refresh it.`);
    }

    applyAssetImport([checked]);
    if (!Store.save()) return;

    logActivity('Added', checked.serial_no, `${checked.model} · shipped ${checked.shipped_at} · ${checked.warranty_months} month warranty`);
    closeModal();
    resetAssetPage();
    renderAssets();
    showToast(`${checked.serial_no} added`);
}

// ═══════════════════════════════════════════════════════════════════
// ORDERS — purchase orders with free-text customer/supplier names.
// customer_org_id links by name (see Organization links below); the supplier
// *_org_id columns stay null until vendor orgs ship.
// ═══════════════════════════════════════════════════════════════════

function getOrderById(id) { return ORDERS.find(o => o.id === id) || null; }

function getOrderLines(orderId) {
    return ORDER_LINES.filter(l => l.order_id === orderId).sort((a, b) => a.line_no - b.line_no);
}

function orderStatusLabel(s) { return ({ DRAFT: 'still a draft', CONFIRMED: 'confirmed', CANCELLED: 'cancelled' })[s] || 'not confirmed'; }

function orderStatusBadge(s) {
    const m = {
        DRAFT: '<span class="badge badge-draft">Draft</span>',
        CONFIRMED: '<span class="badge badge-green">Confirmed</span>',
        CANCELLED: '<span class="badge badge-red">Cancelled</span>',
    };
    return m[s] || `<span class="badge badge-zinc">${esc(s)}</span>`;
}

function orderSuppliersCell(o) {
    const parts = [];
    if (o.hw_supplier_name) parts.push(`<span class="badge badge-hw">HW</span> <span style="font-size:13px;color:#1d1d1f">${esc(o.hw_supplier_name)}</span>`);
    if (o.sw_supplier_name) parts.push(`<span class="badge badge-sw">SW</span> <span style="font-size:13px;color:#1d1d1f">${esc(o.sw_supplier_name)}</span>`);
    if (o.si_name) parts.push(`<span class="badge badge-si">SI</span> <span style="font-size:13px;color:#1d1d1f">${esc(o.si_name)}</span>`);
    return parts.length ? `<div class="flex items-center gap-3 flex-wrap">${parts.map(p => `<span class="flex items-center gap-1.5">${p}</span>`).join('')}</div>` : '<span style="color:#86868b">—</span>';
}

function setOrderFilter(val) {
    document.getElementById('order-filter-status').value = val;
    document.querySelectorAll('#order-filter-tabs .filter-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.val === val));
    renderOrders();
}

function getFilteredOrders() {
    const status = document.getElementById('order-filter-status')?.value || '';
    const q = (document.getElementById('order-search')?.value || '').trim().toLowerCase();
    return ORDERS.filter(o => {
        // A customer sees only their own orders, and never a draft.
        if (isCustomerView() && (o.customer_org_id !== activeOrgId() || o.status === 'DRAFT')) return false;
        if (status && o.status !== status) return false;
        if (q && ![o.order_no, o.customer_name, o.hw_supplier_name, o.sw_supplier_name, o.si_name]
            .some(v => (v || '').toLowerCase().includes(q))) return false;
        return true;
    }).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
}

function renderOrders() {
    const list = getFilteredOrders();
    const searching = !!(document.getElementById('order-search')?.value || '').trim();

    document.getElementById('orders-tbody').innerHTML = list.length ? list.map(o => `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showOrderDetail('${o.id}')">
            <td><span style="font-weight:600;font-size:13px;color:#1d1d1f">${esc(o.order_no)}</span>
                ${o.contract_no ? `<div style="font-size:11.5px;color:#86868b;margin-top:1px">${esc(o.contract_no)}</div>` : ''}</td>
            <td><span style="font-size:13px;color:#1d1d1f">${esc(o.customer_name)}</span></td>
            <td>${orderSuppliersCell(o)}</td>
            <td><span style="font-size:13px;color:#86868b;font-variant-numeric:tabular-nums">${esc(o.order_date || '—')}</span></td>
            <td><span style="font-size:13px;color:#86868b">${getOrderLines(o.id).length}</span></td>
            <td>${orderStatusBadge(o.status)}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <div class="flex items-center gap-0.5 justify-end">
                    <button onclick="showOrderDetail('${o.id}')" class="btn-ghost" title="Details"><i class="ph ph-info"></i></button>
                    ${o.status === 'DRAFT' && canUpdateOrders() ? `<button onclick="showOrderModal('${o.id}')" class="btn-ghost" title="Edit"><i class="ph ph-pencil-simple"></i></button>` : ''}
                </div>
            </td>
        </tr>`).join('') : `<tr><td colspan="7" class="text-center py-16">${emptyState(
        'ph-shopping-cart',
        searching ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searching && canCreateOrders() ? '<div class="flex items-center gap-2 justify-center mt-1"><button onclick="showOrderModal()" class="btn-primary text-xs"><i class="ph ph-plus"></i> New Order</button></div>' : ''
    )}</td></tr>`;
}

// ── Create / Edit ──
// The modal edits a draft copy; nothing touches ORDERS/ORDER_LINES until save.
// Inputs write straight into the draft; only structural changes (add/remove
// line, qty, scope, product pick) re-render the line cards.

let orderDraft = null;

// Draft lines get their id up front: a bundled SW line points at its HW
// line by id before either has been saved.
function newOrderLineDraft(lineNo) {
    return {
        id: `ol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        line_no: lineNo, scope: 'HW', product_id: '', product_name: '', qty: 1,
        sla_plan: '',
        serial_nos: [''], bom: [],
        warranty_months: '', warranty_start: '',
        parent_line_id: null, supplier_name: '',
        license_keys: [], version: '', license_start: '', license_end: '',
        notes: '',
    };
}

function showOrderModal(orderId = null) {
    const existing = orderId ? getOrderById(orderId) : null;
    if (orderId && !existing) return;
    if (existing && existing.status !== 'DRAFT') {
        showToast('Only draft orders can be edited.', 'error');
        return;
    }
    orderDraft = existing ? {
        ...JSON.parse(JSON.stringify(existing)),
        lines: JSON.parse(JSON.stringify(getOrderLines(orderId))),
        attachments: JSON.parse(JSON.stringify(existing.attachments || [])),
    } : {
        id: null, order_no: '', contract_no: '', customer_name: '', customer_org_id: null,
        hw_supplier_name: '', hw_supplier_org_id: null, sw_supplier_name: '', sw_supplier_org_id: null,
        si_name: '', si_org_id: null,
        sales_contact: '', order_date: todayIso(), status: 'DRAFT', notes: '',
        lines: [newOrderLineDraft(1)],
        attachments: [],
    };

    const d = orderDraft;
    const field = (id, label, key, opts = {}) => `
        <div>
            <label class="field-label" for="${id}">${label}${opts.required ? ' <span class="req">*</span>' : ''}</label>
            <input type="${opts.type || 'text'}" id="${id}" class="input-field" autocomplete="off"
                   value="${esc(d[key])}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}
                   ${opts.list ? `list="${opts.list}"` : ''} oninput="orderDraft.${key}=this.value.trim()">
            ${opts.hint ? `<div class="field-hint">${esc(opts.hint)}</div>` : ''}
        </div>`;

    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 18px">${existing ? `Edit ${esc(existing.order_no)}` : 'New Order'}</h3>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 18px">
                ${field('ord-no', 'Order No', 'order_no', { required: true, placeholder: 'PO-2026-0001' })}
                ${field('ord-contract', 'Contract No', 'contract_no', { placeholder: 'Optional' })}
                ${field('ord-date', 'Order Date', 'order_date', { required: true, type: 'date' })}
                ${field('ord-sales', 'Sales Contact', 'sales_contact', { placeholder: 'Optional' })}
                ${field('ord-customer', 'Customer', 'customer_name', { required: true, placeholder: 'Type the customer name', hint: 'Free text. Pick a suggestion to link it to that organization.', list: 'ord-customer-orgs' })}
                <datalist id="ord-customer-orgs">${getCustomerOrgs().map(org => `<option value="${esc(org.name)}"></option>`).join('')}</datalist>
                ${field('ord-si', 'System Integrator', 'si_name', { placeholder: 'Optional', hint: 'Free text. The SI that delivers and installs, if any.' })}
                ${field('ord-hw-sup', 'HW Supplier', 'hw_supplier_name', { placeholder: 'Required when the order has HW lines', hint: 'Free text. Required if any line is HW.' })}
                ${field('ord-sw-sup', 'SW Supplier', 'sw_supplier_name', { placeholder: 'Required when the order has SW lines', hint: 'Free text. Required if any line is SW.' })}
            </div>

            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;margin:22px 0 10px">Documents</div>
            ${ticketAttachmentDropZone('ord-draft-files', "onOrderDocFiles('orderDraft', this.files)")}
            <div class="field-hint" style="margin-top:6px">${ORDER_DOC_HINT}</div>
            <p id="ord-att-error" style="font-size:12px;font-weight:600;color:#dc2626;margin-top:6px"></p>
            <div id="ord-attachments-list" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${orderDocRows('orderDraft')}</div>

            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;margin:22px 0 10px">Order Lines</div>
            <div id="ord-lines"></div>
            <button onclick="ordAddLine()" class="btn-secondary text-xs" style="width:100%"><i class="ph ph-plus"></i> Add Line</button>

            <p id="ord-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin-top:12px"></p>

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="closeModal()" class="btn-secondary text-xs">Cancel</button>
                <button onclick="saveOrder('DRAFT')" class="btn-secondary text-xs">Save as Draft</button>
                <button onclick="saveOrder('CONFIRMED')" class="btn-primary text-xs">Confirm Order</button>
            </div>
        </div>
    `, true);

    renderOrderDraftLines();
    setTimeout(() => document.getElementById('ord-no')?.focus(), 50);
}

function renderOrderDraftLines() {
    const host = document.getElementById('ord-lines');
    if (!host) return;
    // Bundled SW lines render inside their HW line's card, not on their own.
    host.innerHTML = orderDraft.lines.map((l, i) => l.parent_line_id ? '' : ordLineCard(l, i)).join('');
}

function ordLineCard(l, i) {
    const lines = orderDraft.lines;
    const parent = l.parent_line_id ? lines.find(x => x.id === l.parent_line_id) : null;
    const products = getVisibleProducts(l.scope === 'HW' ? 'hardware' : 'software').filter(p => p.status === 'published');
    const knownProduct = l.product_id && products.some(p => p.id === l.product_id);
    const removable = parent || lines.filter(x => !x.parent_line_id).length > 1;
    return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;${parent ? 'margin-top:10px;background:#fff' : 'margin-bottom:12px'}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                <span style="font-size:12.5px;font-weight:700;color:#86868b">Line ${i + 1}</span>
                <span class="badge ${l.scope === 'HW' ? 'badge-hw' : 'badge-sw'}">${l.scope}</span>
                ${parent ? `<span class="field-hint" style="margin:0">bundled with Line ${lines.indexOf(parent) + 1}</span>` : ''}
                ${removable ? `<button onclick="ordRemoveLine(${i})" class="btn-ghost" style="margin-left:auto" title="Remove line"><i class="ph ph-trash"></i></button>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:${parent ? '' : '100px '}1fr 120px 80px;gap:12px">
                ${parent ? '' : `
                <div>
                    <label class="field-label">Scope</label>
                    <select class="input-field" onchange="ordSetScope(${i}, this.value)">
                        <option value="HW" ${l.scope === 'HW' ? 'selected' : ''}>HW</option>
                        <option value="SW" ${l.scope === 'SW' ? 'selected' : ''}>SW</option>
                    </select>
                </div>`}
                <div>
                    <label class="field-label">Product</label>
                    <select class="input-field" onchange="ordSetProduct(${i}, this.value)">
                        <option value="">— Select a published product —</option>
                        ${products.map(p => `<option value="${p.id}" ${l.product_id === p.id ? 'selected' : ''}>${esc(p.name)}${p.model ? ` (${esc(p.model)})` : ''}</option>`).join('')}
                        <option value="__custom" ${l.product_name && !knownProduct ? 'selected' : ''}>Other (type a name)</option>
                    </select>
                    ${l.product_id ? '' : `<input type="text" class="input-field" style="margin-top:8px" placeholder="Product name"
                        value="${esc(l.product_name)}" oninput="orderDraft.lines[${i}].product_name=this.value.trim()">`}
                </div>
                <div>
                    <label class="field-label">SLA</label>
                    <select class="input-field" onchange="orderDraft.lines[${i}].sla_plan=this.value">
                        <option value="">—</option>
                        ${ORDER_SLA_PLAN_OPTIONS.map(sp => `<option value="${esc(sp)}" ${l.sla_plan === sp ? 'selected' : ''}>${esc(sp)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="field-label">Qty</label>
                    <input type="number" class="input-field" min="1" step="1" value="${l.qty}" onchange="ordSetQty(${i}, this.value)">
                </div>
            </div>
            ${l.scope === 'HW' ? `
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
                <div>
                    <label class="field-label">Warranty (months)</label>
                    <input type="number" class="input-field" min="1" step="1" value="${esc(l.warranty_months)}"
                           oninput="orderDraft.lines[${i}].warranty_months=this.value;ordRefreshWarrantyEnd(${i})">
                </div>
                <div>
                    <label class="field-label">Warranty Start</label>
                    <input type="date" class="input-field" value="${esc(l.warranty_start)}"
                           oninput="orderDraft.lines[${i}].warranty_start=this.value;ordRefreshWarrantyEnd(${i})">
                    <div class="field-hint">Usually the ship date — leave blank until shipped.</div>
                </div>
                <div>
                    <label class="field-label">Warranty End</label>
                    <input type="text" class="input-field" id="ord-wend-${i}" value="${esc(ordWarrantyEnd(l) || '—')}" readonly tabindex="-1" style="background:var(--bg-subtle);color:#86868b">
                    <div class="field-hint">Computed from start + term.</div>
                </div>
            </div>
            <div style="margin-top:12px">
                <label class="field-label">Serial Numbers (${l.serial_nos.filter(s => s.trim()).length} of ${l.qty})</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${l.serial_nos.map((sn, si) => `
                    <div style="display:flex;align-items:center;gap:10px">
                        <span style="font-size:11.5px;font-weight:600;color:#86868b;width:48px;flex-shrink:0">Unit ${si + 1}</span>
                        <input type="text" class="input-field" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace" placeholder="Serial number"
                               value="${esc(sn)}" oninput="orderDraft.lines[${i}].serial_nos[${si}]=this.value.trim()">
                    </div>`).join('')}
                </div>
                <div class="field-hint">One serial per unit — the row count follows Qty. Required before the order is confirmed.</div>
            </div>
            <div style="margin-top:12px;border:1px dashed var(--border);border-radius:10px;background:var(--bg-subtle);padding:12px 14px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                    <span style="font-size:12.5px;font-weight:700">Custom BOM</span>
                    <span class="field-hint" style="margin:0">applies to every unit in this line</span>
                </div>
                ${l.bom.length ? `
                <table style="width:100%;border-collapse:collapse">
                    <thead><tr>
                        <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 8px 6px 0;width:22%">Component</th>
                        <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 8px 6px 0;width:22%">Brand</th>
                        <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 8px 6px 0">Model</th>
                        <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 0 6px 0;width:64px">Qty</th>
                        <th style="width:34px"></th>
                    </tr></thead>
                    <tbody>
                        ${l.bom.map((b, bi) => `
                        <tr>
                            <td style="padding:3px 8px 3px 0"><input type="text" class="input-field" placeholder="CPU" value="${esc(b.component_type)}" oninput="orderDraft.lines[${i}].bom[${bi}].component_type=this.value.trim()"></td>
                            <td style="padding:3px 8px 3px 0"><input type="text" class="input-field" placeholder="—" value="${esc(b.brand)}" oninput="orderDraft.lines[${i}].bom[${bi}].brand=this.value.trim()"></td>
                            <td style="padding:3px 8px 3px 0"><input type="text" class="input-field" placeholder="Model" value="${esc(b.model)}" oninput="orderDraft.lines[${i}].bom[${bi}].model=this.value.trim()"></td>
                            <td style="padding:3px 0"><input type="number" class="input-field" min="1" step="1" value="${b.qty}" oninput="orderDraft.lines[${i}].bom[${bi}].qty=parseInt(this.value,10)||1"></td>
                            <td style="padding:3px 0 3px 4px;text-align:right"><button onclick="ordRemoveBom(${i},${bi})" class="btn-ghost" title="Remove component"><i class="ph ph-x"></i></button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>` : ''}
                <button onclick="ordAddBom(${i})" class="btn-secondary text-xs" style="margin-top:${l.bom.length ? '10px' : '0'}"><i class="ph ph-plus"></i> Add Component</button>
            </div>
            ${ordBundleSection(l, i)}` : `
            <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:12px;margin-top:12px">
                <div>
                    <label class="field-label">Supplier</label>
                    <input type="text" class="input-field" placeholder="${esc(orderDraft.sw_supplier_name || 'Order SW supplier')}" value="${esc(l.supplier_name)}" oninput="orderDraft.lines[${i}].supplier_name=this.value.trim()">
                    <div class="field-hint">Blank uses the order's SW supplier.</div>
                </div>
                <div>
                    <label class="field-label">Version</label>
                    <input type="text" class="input-field" placeholder="e.g. 4.1.0" value="${esc(l.version)}" oninput="orderDraft.lines[${i}].version=this.value.trim()">
                </div>
                <div>
                    <label class="field-label">License Start</label>
                    <input type="date" class="input-field" value="${esc(l.license_start)}" oninput="orderDraft.lines[${i}].license_start=this.value">
                </div>
                <div>
                    <label class="field-label">License End</label>
                    <input type="date" class="input-field" value="${esc(l.license_end)}" oninput="orderDraft.lines[${i}].license_end=this.value">
                </div>
            </div>
            <div style="margin-top:12px">
                <label class="field-label">License Keys (${l.license_keys.filter(k => k.key).length} of ${l.qty})</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${l.license_keys.map((lk, ki) => `
                    <div style="display:flex;align-items:center;gap:10px">
                        <span style="font-size:11.5px;font-weight:600;color:#86868b;width:48px;flex-shrink:0">Key ${ki + 1}</span>
                        <input type="text" class="input-field" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace" placeholder="License key"
                               value="${esc(lk.key)}" oninput="orderDraft.lines[${i}].license_keys[${ki}].key=this.value.trim()">
                        ${parent ? `<select class="input-field" style="width:230px;flex-shrink:0" title="Which unit this key is for"
                               onchange="orderDraft.lines[${i}].license_keys[${ki}].unit=this.value===''?null:Number(this.value)">${ordUnitOptions(parent, lk.unit)}</select>` : ''}
                    </div>`).join('')}
                </div>
                <div class="field-hint">${parent
                    ? 'Bind each key to one unit or to all units. Repeat a key on several rows to share it between units.'
                    : 'One key per license — the row count follows Qty. Required before the order is confirmed.'}</div>
            </div>`}
        </div>`;
}

// ── Bundled software (docs/ORDER_MANAGEMENT_PLAN.md, License ↔ SN) ──
// A bundled SW line is an ordinary SW line with parent_line_id set. It sits
// right after its HW line in the array, so line numbers stay in order.

function ordBundleSection(l, i) {
    const children = orderDraft.lines.filter(x => l.id && x.parent_line_id === l.id);
    return `
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-light)">
                <label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer">
                    <input type="checkbox" ${children.length ? 'checked' : ''} onchange="ordToggleBundle(${i}, this.checked)"> Includes software licenses
                </label>
                ${children.length ? `
                <div style="margin-left:18px">
                    ${children.map(c => ordLineCard(c, orderDraft.lines.indexOf(c))).join('')}
                    <button onclick="ordAddBundled(${i})" class="btn-secondary text-xs" style="margin-top:10px"><i class="ph ph-plus"></i> Add Software</button>
                </div>` : ''}
            </div>`;
}

// The binding is by unit index, so a unit whose serial is still blank can
// already take a key. A unit that Qty no longer covers stays selected and is
// flagged; saving refuses it rather than silently rebinding.
function ordUnitOptions(parent, unit) {
    const units = parent.serial_nos.map((sn, u) => `<option value="${u}" ${unit === u ? 'selected' : ''}>Unit ${u + 1} · ${esc(sn.trim() || 'serial pending')}</option>`);
    const gone = unit !== null && unit >= parent.qty ? `<option value="${unit}" selected>Unit ${unit + 1} (removed)</option>` : '';
    return `<option value="" ${unit === null ? 'selected' : ''}>All units</option>${units.join('')}${gone}`;
}

function ordAddBundled(i) {
    const parent = orderDraft.lines[i];
    const child = {
        ...newOrderLineDraft(0), scope: 'SW', parent_line_id: parent.id, serial_nos: [], qty: parent.qty,
        // Default to one key per unit, in order — the common case.
        license_keys: Array.from({ length: parent.qty }, (_, u) => ({ key: '', unit: u })),
    };
    let at = i + 1;
    while (at < orderDraft.lines.length && orderDraft.lines[at].parent_line_id === parent.id) at++;
    orderDraft.lines.splice(at, 0, child);
    renderOrderDraftLines();
}

function ordToggleBundle(i, on) {
    if (on) { ordAddBundled(i); return; }
    const parentId = orderDraft.lines[i].id;
    const children = orderDraft.lines.filter(x => x.parent_line_id === parentId);
    if (children.some(c => c.license_keys.some(k => k.key)) && !window.confirm('Remove the bundled software and the license keys entered for it?')) {
        renderOrderDraftLines();
        return;
    }
    orderDraft.lines = orderDraft.lines.filter(x => x.parent_line_id !== parentId);
    renderOrderDraftLines();
}

function ordAddLine() {
    orderDraft.lines.push(newOrderLineDraft(orderDraft.lines.length + 1));
    renderOrderDraftLines();
}

function ordRemoveLine(i) {
    const id = orderDraft.lines[i].id;
    orderDraft.lines = orderDraft.lines.filter((x, xi) => xi !== i && !(id && x.parent_line_id === id));
    renderOrderDraftLines();
}

function ordSetScope(i, scope) {
    const l = orderDraft.lines[i];
    if (l.scope === scope) return;
    l.scope = scope;
    l.product_id = '';
    l.product_name = '';
    if (scope === 'SW') {
        l.serial_nos = []; l.bom = [];
        l.warranty_months = ''; l.warranty_start = '';
        l.license_keys = Array.from({ length: l.qty }, () => ({ key: '', unit: null }));
        // A SW line cannot carry bundled software.
        orderDraft.lines = orderDraft.lines.filter(x => x.parent_line_id !== l.id);
    } else {
        l.serial_nos = Array.from({ length: l.qty }, () => '');
        l.license_keys = []; l.version = ''; l.license_start = ''; l.license_end = '';
    }
    renderOrderDraftLines();
}

function ordSetProduct(i, value) {
    const l = orderDraft.lines[i];
    if (value && value !== '__custom') {
        const p = PRODUCTS.find(x => x.id === value);
        l.product_id = value;
        l.product_name = p ? p.name : '';
    } else {
        l.product_id = '';
        if (value !== '__custom') l.product_name = '';
    }
    renderOrderDraftLines();
}

function ordSetQty(i, value) {
    const l = orderDraft.lines[i];
    l.qty = Math.max(1, parseInt(value, 10) || 1);
    // Keep what's typed; only grow or shrink the array to match qty.
    if (l.scope === 'HW') {
        l.serial_nos = Array.from({ length: l.qty }, (_, si) => l.serial_nos[si] || '');
    } else {
        l.license_keys = Array.from({ length: l.qty }, (_, ki) => l.license_keys[ki] || { key: '', unit: null });
    }
    renderOrderDraftLines();
}

// Same derivation the Asset Registry uses: end = start + term. Only computed
// when both parts exist; the start usually waits for the ship date.
function ordWarrantyEnd(l) {
    const months = parseInt(l.warranty_months, 10);
    if (!l.warranty_start || !months || months < 1) return '';
    return addMonthsToDate(l.warranty_start, months);
}

function ordRefreshWarrantyEnd(i) {
    const el = document.getElementById(`ord-wend-${i}`);
    if (el) el.value = ordWarrantyEnd(orderDraft.lines[i]) || '—';
}

function ordAddBom(i) {
    orderDraft.lines[i].bom.push({ component_type: '', brand: '', model: '', qty: 1 });
    renderOrderDraftLines();
}

function ordRemoveBom(i, bi) {
    orderDraft.lines[i].bom.splice(bi, 1);
    renderOrderDraftLines();
}

// ── Documents ──
// Header-level attachments (PO scans, contracts, sign-off sheets). Reuses the
// ticket attachment file-read/validation pipeline — same size/type limits,
// with a higher count since an order collects papers over its life.
// Every file carries a doc_type so the detail view can filter by kind; files
// saved before types existed read as Unclassified until someone picks one.
// The editor (orderDraft, DRAFT orders) and the Manage documents modal
// (orderDocDraft, confirmed orders — acceptance and delivery papers arrive
// after confirmation) share one list renderer, addressed by `ns`.

const ORDER_DOC_TYPES = [
    { key: 'PO', label: 'Purchase order' },
    { key: 'QUOTATION', label: 'Quotation' },
    { key: 'CONTRACT', label: 'Contract' },
    { key: 'ACCEPTANCE', label: 'Acceptance' },
    { key: 'DELIVERY', label: 'Delivery receipt' },
    { key: 'OTHER', label: 'Other' },
];
const ORDER_DOC_MAX_COUNT = 10;
const ORDER_DOC_HINT = 'Pick a type for each file. PNG, JPG, PDF, TXT, LOG, CSV or JSON; up to 10 files; images up to 5 MB, other files up to 500 KB.';

function orderDocTypeLabel(key) { return ORDER_DOC_TYPES.find(t => t.key === key)?.label || 'Unclassified'; }

let orderDocDraft = null;
function orderDocTarget(ns) { return ns === 'orderDraft' ? orderDraft : orderDocDraft; }

function orderDocRows(ns) {
    const list = orderDocTarget(ns)?.attachments || [];
    return list.map((a, i) => `
        <div class="ord-doc-row ${a.doc_type ? '' : 'untyped'}">
            <span class="ord-doc-tile">${a.is_image ? `<img src="${a.data_url}" alt="">` : '<i class="ph ph-file-text"></i>'}</span>
            <span class="ord-doc-name" title="${esc(a.name)}"><span class="nm">${esc(a.name)}</span><span class="sz">${formatFileSize(a.size)}${a.doc_type ? '' : ' · pick a type'}</span></span>
            <select class="input-field ord-doc-type" aria-label="Document type for ${esc(a.name)}"
                    onchange="orderDocTarget('${ns}').attachments[${i}].doc_type=this.value;renderOrderDocRows('${ns}')">
                <option value="" disabled ${a.doc_type ? '' : 'selected'}>Choose type…</option>
                ${ORDER_DOC_TYPES.map(t => `<option value="${t.key}" ${a.doc_type === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
            <button class="btn-ghost" onclick="removeOrderDoc('${ns}', ${i})" title="Remove ${esc(a.name)}"><i class="ph ph-x"></i></button>
        </div>`).join('');
}

function renderOrderDocRows(ns) {
    const host = document.getElementById('ord-attachments-list');
    if (host) host.innerHTML = orderDocRows(ns);
}

async function onOrderDocFiles(ns, fileList) {
    const target = orderDocTarget(ns);
    if (!target) return;
    const { added, error } = await readTicketAttachments(fileList, target.attachments, ORDER_DOC_MAX_COUNT);
    target.attachments.push(...added.map(a => ({ ...a, doc_type: '' })));
    renderOrderDocRows(ns);
    const errEl = document.getElementById('ord-att-error');
    if (errEl) errEl.textContent = error || '';
}

function removeOrderDoc(ns, i) {
    orderDocTarget(ns).attachments.splice(i, 1);
    renderOrderDocRows(ns);
}

function untypedDocError(list) {
    const a = list.find(x => !x.doc_type);
    return a ? `Documents: choose a type for ${a.name}.` : '';
}

// Detail view: filter chips (only when there is more than one kind) above the
// files; indexes stay the stored ones so the image preview finds the file.
let orderDocFilter = { orderId: null, type: null };

function setOrderDocFilter(orderId, type) {
    orderDocFilter = { orderId, type };
    showOrderDetail(orderId);
}

function orderDocSection(o) {
    const docs = o.attachments || [];
    const canManage = o.status === 'CONFIRMED' && canUpdateOrders();
    if (!docs.length && !canManage) return '';
    const kinds = [...new Set(docs.map(a => a.doc_type || ''))];
    const active = orderDocFilter.orderId === o.id && kinds.includes(orderDocFilter.type) ? orderDocFilter.type : null;
    const chip = (type, label, count) => `<button class="tk-chip ${active === type ? 'active' : ''}" onclick="setOrderDocFilter('${o.id}', ${type === null ? 'null' : `'${type}'`})">${esc(label)} <span style="opacity:.6">${count}</span></button>`;
    const ordered = [...ORDER_DOC_TYPES.map(t => t.key).filter(k => kinds.includes(k)), ...(kinds.includes('') ? [''] : [])];
    return `
            <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#86868b">Documents</span>
                ${canManage ? `<button onclick="showOrderDocsModal('${o.id}')" class="btn-secondary text-xs" style="padding:4px 10px"><i class="ph ph-paperclip"></i> Manage documents</button>` : ''}
            </div>
            ${kinds.length > 1 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${chip(null, 'All', docs.length)}${ordered.map(k => chip(k, orderDocTypeLabel(k), docs.filter(a => (a.doc_type || '') === k).length)).join('')}
            </div>` : ''}
            ${docs.length ? `<div class="tk-att-list">${orderAttachmentGallery(o, active)}</div>`
                : '<div style="font-size:12.5px;color:#86868b">No documents yet — add acceptance or delivery papers as they arrive.</div>'}`;
}

function orderAttachmentGallery(o, type = null) {
    return (o.attachments || []).map((a, i) => {
        if (type !== null && (a.doc_type || '') !== type) return '';
        const label = `<span style="font-size:10.5px;font-weight:600;color:${a.doc_type ? '#52525b' : '#b45309'}">${esc(orderDocTypeLabel(a.doc_type))}</span>`;
        return `<span style="display:inline-flex;flex-direction:column;gap:3px;align-items:flex-start">${label}${a.is_image
            ? `<img class="tk-att-thumb" src="${a.data_url}" alt="${esc(a.name)}" title="${esc(a.name)}" onclick="showOrderAttachmentPreview('${o.id}', ${i})">`
            : `<a class="tk-att-chip" href="${a.data_url}" download="${esc(a.name)}" title="Download ${esc(a.name)}">
                <i class="ph ph-file-text"></i><span class="nm">${esc(a.name)}</span><span class="sz">${formatFileSize(a.size)}</span><i class="ph ph-download-simple"></i>
               </a>`}</span>`;
    }).join('');
}

// Manage documents on a confirmed order: add, retype or remove files without
// reopening the rest of the order. Changes are logged as one entry.
function showOrderDocsModal(orderId) {
    const o = getOrderById(orderId);
    if (!o || o.status !== 'CONFIRMED' || !canUpdateOrders()) return;
    orderDocDraft = { orderId, attachments: JSON.parse(JSON.stringify(o.attachments || [])) };
    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Documents · ${esc(o.order_no)}</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">Add papers that arrive after confirmation, such as acceptance or delivery receipts. Changes are recorded in the Activity Log.</p>
            ${ticketAttachmentDropZone('ord-doc-files', "onOrderDocFiles('orderDocDraft', this.files)")}
            <div class="field-hint" style="margin-top:6px">${ORDER_DOC_HINT}</div>
            <p id="ord-att-error" style="font-size:12px;font-weight:600;color:#dc2626;margin-top:6px"></p>
            <div id="ord-attachments-list" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${orderDocRows('orderDocDraft')}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="orderDocDraft=null;showOrderDetail('${o.id}')" class="btn-secondary text-xs">Cancel</button>
                <button onclick="saveOrderDocs()" class="btn-primary text-xs">Save documents</button>
            </div>
        </div>`, true);
}

function saveOrderDocs() {
    const d = orderDocDraft;
    const o = getOrderById(d.orderId);
    const error = untypedDocError(d.attachments);
    if (error) {
        document.getElementById('ord-att-error').textContent = error;
        return;
    }
    const before = new Map((o.attachments || []).map(a => [a.id, a]));
    const after = new Set(d.attachments.map(a => a.id));
    const changes = [
        ...d.attachments.filter(a => !before.has(a.id)).map(a => `+ ${a.name} (${orderDocTypeLabel(a.doc_type)})`),
        ...d.attachments.filter(a => before.has(a.id) && (before.get(a.id).doc_type || '') !== a.doc_type)
            .map(a => `${a.name}: ${orderDocTypeLabel(before.get(a.id).doc_type)} → ${orderDocTypeLabel(a.doc_type)}`),
        ...[...before.values()].filter(a => !after.has(a.id)).map(a => `− ${a.name}`),
    ];
    if (changes.length) {
        const ok = commitPortalMutation(() => {
            o.attachments = d.attachments;
            o.updated_at = new Date().toISOString();
            logActivity('Order documents updated', o.order_no, changes.join('; '));
        });
        if (!ok) return;
        showToast(`Documents updated on ${o.order_no}`);
    }
    orderDocDraft = null;
    showOrderDetail(o.id);
}

function showOrderAttachmentPreview(orderId, index) {
    const o = getOrderById(orderId);
    const a = o?.attachments?.[index];
    if (!a) return;
    document.getElementById('tk-preview-root').innerHTML = `
        <div class="tk-preview" onclick="closeTicketAttachmentPreview()">
            <img src="${a.data_url}" alt="${esc(a.name)}">
            <div class="cap">${esc(a.name)} · ${formatFileSize(a.size)} · click anywhere to close</div>
        </div>`;
}

function validateOrderDraft(status) {
    const d = orderDraft;
    const errors = [];
    if (!d.order_no) errors.push('Order No is required.');
    if (!d.order_date) errors.push('Order Date is required.');
    if (!d.customer_name) errors.push('Customer is required.');
    if (!d.lines.length) errors.push('At least one order line is required.');
    if (untypedDocError(d.attachments || [])) errors.push(untypedDocError(d.attachments));
    if (d.lines.some(l => l.scope === 'HW') && !d.hw_supplier_name) errors.push('HW Supplier is required because the order has HW lines.');
    if (d.lines.some(l => l.scope === 'SW' && !l.supplier_name) && !d.sw_supplier_name) errors.push('SW Supplier is required because a SW line has no supplier of its own.');
    d.lines.forEach((l, i) => {
        if (!l.product_name) errors.push(`Line ${i + 1}: product is required.`);
        if (l.scope === 'HW' && l.bom.some(b => !b.component_type || !b.model)) errors.push(`Line ${i + 1}: every BOM row needs a component and a model.`);
        if (l.scope === 'SW') errors.push(...licenseLineErrors(l, `Line ${i + 1}`, d.lines.find(x => x.id === l.parent_line_id)));
    });
    if (status === 'CONFIRMED') {
        const seenSerials = new Set();
        errors.push(...licenseKeyDuplicateErrors(d.lines));
        d.lines.forEach((l, i) => {
            if (!l.sla_plan) errors.push(`Line ${i + 1}: an SLA plan is required to confirm.`);
            if (l.scope === 'HW') {
                if (!(parseInt(l.warranty_months, 10) >= 1)) errors.push(`Line ${i + 1}: the warranty term is required to confirm.`);
                if (l.serial_nos.some(sn => !sn.trim())) errors.push(`Line ${i + 1}: all ${l.qty} serial numbers are required to confirm.`);
                l.serial_nos.forEach(sn => {
                    const key = sn.trim().toUpperCase();
                    if (!key) return;
                    if (seenSerials.has(key)) errors.push(`Line ${i + 1}: serial ${sn} appears twice in this order.`);
                    seenSerials.add(key);
                });
            } else {
                if (!l.license_start || !l.license_end) errors.push(`Line ${i + 1}: the license period is required to confirm.`);
                if (l.license_keys.some(lk => !lk.key.trim())) errors.push(`Line ${i + 1}: all ${l.qty} license keys are required to confirm.`);
            }
        });
    }
    const duplicate = ORDERS.find(o => o.id !== d.id && o.order_no.toLowerCase() === d.order_no.toLowerCase());
    if (duplicate) errors.push(`Order No ${d.order_no} already exists.`);
    return errors;
}

// Checks one SW line on its own; shared by the order editor and the
// post-confirmation license adjustment.
function licenseLineErrors(l, label, parent) {
    const errors = [];
    if (l.license_start && l.license_end && l.license_start > l.license_end) errors.push(`${label}: license start is after license end.`);
    if (parent) l.license_keys.forEach((lk, ki) => {
        if (lk.unit !== null && lk.unit >= parent.qty) errors.push(`${label}: key ${ki + 1} is bound to Unit ${lk.unit + 1}, which the hardware line no longer has. Rebind it.`);
    });
    return errors;
}

// A key may repeat inside one bundled line to cover several units, never
// across lines and never twice on the same unit (or next to "All units").
function licenseKeyDuplicateErrors(lines) {
    const errors = [];
    const seen = new Map(); // KEY → { lineIndex, units }
    lines.forEach((l, i) => (l.license_keys || []).forEach(lk => {
        const key = lk.key.trim().toUpperCase();
        if (!key) return;
        const prior = seen.get(key);
        if (!prior) { seen.set(key, { lineIndex: i, units: new Set([lk.unit]) }); return; }
        if (prior.lineIndex !== i) errors.push(`License key ${lk.key} is on both line ${prior.lineIndex + 1} and line ${i + 1}.`);
        else if (lk.unit === null || prior.units.has(null) || prior.units.has(lk.unit)) errors.push(`Line ${i + 1}: license key ${lk.key} repeats without a different unit.`);
        prior.units.add(lk.unit);
    }));
    return errors;
}

function licenseUnitLabel(parent, unit) {
    if (unit === null) return 'All units';
    if (unit >= parent.qty) return `Unit ${unit + 1} (removed)`;
    return `Unit ${unit + 1} · ${(parent.serial_nos[unit] || '').trim() || 'serial pending'}`;
}

// ── Adjust license (confirmed orders) ──
// Keys get reissued, renewed or rebound after an order is confirmed. Only the
// SW line's license fields are editable here; the rest of the order stays
// locked, and every change lands in the Activity Log with before → after.

let licenseDraft = null;

function showLicenseAdjustModal(lineId) {
    const line = ORDER_LINES.find(l => l.id === lineId);
    const order = line ? getOrderById(line.order_id) : null;
    if (!line || line.scope !== 'SW' || order?.status !== 'CONFIRMED' || !canUpdateOrders()) return;
    licenseDraft = {
        lineId,
        supplier_name: line.supplier_name || '', version: line.version || '',
        license_start: line.license_start || '', license_end: line.license_end || '',
        license_keys: (line.license_keys || []).map(lk => ({ ...lk })),
    };
    renderLicenseAdjustModal();
}

function renderLicenseAdjustModal() {
    const d = licenseDraft;
    const line = ORDER_LINES.find(l => l.id === d.lineId);
    const order = getOrderById(line.order_id);
    const parent = line.parent_line_id ? ORDER_LINES.find(x => x.id === line.parent_line_id) : null;
    const input = (label, key, type = 'text', placeholder = '') => `
        <div>
            <label class="field-label">${label}</label>
            <input type="${type}" class="input-field" value="${esc(d[key])}" ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} oninput="licenseDraft.${key}=this.value">
        </div>`;
    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Adjust license · ${esc(line.product_name)}</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 18px;line-height:1.6">${esc(order.order_no)} · line ${line.line_no}${parent ? ` · bundled with ${esc(parent.product_name)}` : ''}. Every change is recorded in the Activity Log.</p>
            <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:12px">
                ${input('Supplier', 'supplier_name', 'text', order.sw_supplier_name || 'Order SW supplier')}
                ${input('Version', 'version', 'text', 'e.g. 4.1.0')}
                ${input('License Start', 'license_start', 'date')}
                ${input('License End', 'license_end', 'date')}
            </div>
            <label class="field-label" style="margin-top:14px">License Keys (${d.license_keys.length})</label>
            <div style="display:flex;flex-direction:column;gap:8px">
                ${d.license_keys.map((lk, ki) => `
                <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:11.5px;font-weight:600;color:#86868b;width:48px;flex-shrink:0">Key ${ki + 1}</span>
                    <input type="text" class="input-field" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace" placeholder="License key"
                           value="${esc(lk.key)}" oninput="licenseDraft.license_keys[${ki}].key=this.value">
                    ${parent ? `<select class="input-field" style="width:230px;flex-shrink:0"
                           onchange="licenseDraft.license_keys[${ki}].unit=this.value===''?null:Number(this.value)">${ordUnitOptions(parent, lk.unit)}</select>` : ''}
                    ${d.license_keys.length > 1 ? `<button onclick="licenseDraft.license_keys.splice(${ki},1);renderLicenseAdjustModal()" class="btn-ghost" title="Remove key"><i class="ph ph-x"></i></button>` : ''}
                </div>`).join('')}
            </div>
            <button onclick="licenseDraft.license_keys.push({ key: '', unit: null });renderLicenseAdjustModal()" class="btn-secondary text-xs" style="margin-top:10px"><i class="ph ph-plus"></i> Add Key</button>
            <p id="la-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin-top:12px"></p>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
                <button onclick="licenseDraft=null;showOrderDetail('${order.id}')" class="btn-secondary text-xs">Cancel</button>
                <button onclick="saveLicenseAdjustment()" class="btn-primary text-xs">Save changes</button>
            </div>
        </div>`, true);
}

function saveLicenseAdjustment() {
    const d = licenseDraft;
    const line = ORDER_LINES.find(l => l.id === d.lineId);
    const order = getOrderById(line.order_id);
    const parent = line.parent_line_id ? ORDER_LINES.find(x => x.id === line.parent_line_id) : null;
    const next = {
        supplier_name: d.supplier_name.trim(), version: d.version.trim(),
        license_start: d.license_start, license_end: d.license_end,
        license_keys: d.license_keys.map(lk => ({ key: lk.key.trim(), unit: parent ? lk.unit : null })),
    };
    const errors = [];
    if (!next.license_start || !next.license_end) errors.push('The license period is required.');
    if (next.license_keys.some(lk => !lk.key)) errors.push('Every key row needs a key.');
    if (!next.supplier_name && !order.sw_supplier_name) errors.push('Supplier is required because the order has no SW supplier.');
    errors.push(...licenseLineErrors(next, `Line ${line.line_no}`, parent));
    errors.push(...licenseKeyDuplicateErrors(getOrderLines(order.id).map(l => l.id === line.id ? next : l)));
    if (errors.length) {
        const el = document.getElementById('la-error');
        el.textContent = errors[0];
        el.style.display = 'block';
        return;
    }

    const keyList = keys => keys.map(lk => `${lk.key}${parent ? ` (${licenseUnitLabel(parent, lk.unit)})` : ''}`).join(', ') || '—';
    const changes = [
        ['supplier', line.supplier_name || '', next.supplier_name],
        ['version', line.version || '', next.version],
        ['start', line.license_start || '', next.license_start],
        ['end', line.license_end || '', next.license_end],
        ['keys', keyList(line.license_keys || []), keyList(next.license_keys)],
    ].filter(([, before, after]) => before !== after).map(([field, before, after]) => `${field} ${before || '—'} → ${after || '—'}`);
    if (!changes.length) {
        licenseDraft = null;
        showOrderDetail(order.id);
        return;
    }
    const ok = commitPortalMutation(() => {
        Object.assign(line, next, { qty: next.license_keys.length });
        order.updated_at = new Date().toISOString();
        logActivity('License adjusted', order.order_no, `Line ${line.line_no} ${line.product_name}: ${changes.join('; ')}`);
    });
    if (!ok) return;
    licenseDraft = null;
    showOrderDetail(order.id);
    showToast(`License updated on ${order.order_no}`);
}

function saveOrder(status) {
    const err = document.getElementById('ord-error');
    const errors = validateOrderDraft(status);
    if (errors.length) {
        err.textContent = errors[0];
        err.style.display = 'block';
        return;
    }

    const d = orderDraft;
    const isNew = !d.id;
    const now = new Date().toISOString();
    const prev = isNew ? null : getOrderById(d.id);
    const customerOrgId = prev?.customer_org_id && prev.customer_name === d.customer_name
        ? prev.customer_org_id
        : matchCustomerOrgId(d.customer_name);
    const ok = commitPortalMutation(() => {
        const record = {
            id: d.id || `ord-${Date.now()}`,
            order_no: d.order_no, contract_no: d.contract_no,
            customer_name: d.customer_name, customer_org_id: customerOrgId,
            hw_supplier_name: d.hw_supplier_name, hw_supplier_org_id: d.hw_supplier_org_id,
            sw_supplier_name: d.sw_supplier_name, sw_supplier_org_id: d.sw_supplier_org_id,
            si_name: d.si_name || '', si_org_id: d.si_org_id ?? null,
            sales_contact: d.sales_contact, order_date: d.order_date,
            status, notes: d.notes,
            attachments: d.attachments || [],
            created_at: d.created_at || now, updated_at: now,
        };
        const idx = ORDERS.findIndex(o => o.id === record.id);
        if (idx >= 0) ORDERS[idx] = record; else ORDERS.push(record);

        ORDER_LINES = ORDER_LINES.filter(l => l.order_id !== record.id);
        d.lines.forEach((l, i) => ORDER_LINES.push({
            id: l.id || `ol-${Date.now()}-${i}`,
            order_id: record.id, line_no: i + 1, scope: l.scope,
            product_id: l.product_id || null, product_name: l.product_name,
            qty: l.qty,
            sla_plan: l.sla_plan,
            serial_nos: l.scope === 'HW' ? l.serial_nos.map(sn => sn.trim()) : [],
            bom: l.scope === 'HW' ? l.bom : [],
            warranty_months: l.scope === 'HW' && parseInt(l.warranty_months, 10) >= 1 ? parseInt(l.warranty_months, 10) : null,
            warranty_start: l.scope === 'HW' ? l.warranty_start : '',
            warranty_end: l.scope === 'HW' ? ordWarrantyEnd(l) : '',
            parent_line_id: l.scope === 'SW' ? (l.parent_line_id || null) : null,
            supplier_name: l.scope === 'SW' ? (l.supplier_name || '') : '',
            license_keys: l.scope === 'SW' ? l.license_keys.map(lk => ({ key: lk.key.trim(), unit: l.parent_line_id ? lk.unit : null })) : [],
            version: l.scope === 'SW' ? l.version : '',
            license_start: l.scope === 'SW' ? l.license_start : '',
            license_end: l.scope === 'SW' ? l.license_end : '',
            notes: l.notes || '',
        }));

        logActivity(isNew ? 'Order created' : 'Order updated', record.order_no,
            `${record.customer_name} · ${d.lines.length} line${d.lines.length === 1 ? '' : 's'} · ${status}`);
    });
    if (!ok) return;

    closeModal();
    orderDraft = null;
    renderOrders();
    showToast(`${d.order_no} ${status === 'CONFIRMED' ? 'confirmed' : 'saved as draft'}`);
}

// ── Organization links (docs/ORG_MANAGEMENT_PLAN.md, flow E) ──
// customer_name stays the free-text truth; customer_org_id is the link that
// customer-side scoping reads. Links come from an exact name match, or by hand
// from the order detail when the typed name differs from the org's.

function getOrgById(id) { return ORGS.find(o => o.id === id) || null; }
function getCustomerOrgs() { return ORGS.filter(o => o.types?.includes('CUSTOMER')); }

function matchCustomerOrgId(name) {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    return getCustomerOrgs().find(o => o.name.toLowerCase() === target)?.id || null;
}

// Fill in links that are still missing; an existing link is never replaced,
// since a hand-made one may point at an org whose name differs from the typed
// one. A ticket follows its order first, then its own customer name.
function backfillCustomerOrgIds() {
    let changed = 0;
    ORDERS.forEach(o => {
        if (o.customer_org_id) return;
        const id = matchCustomerOrgId(o.customer_name);
        if (id) { o.customer_org_id = id; changed++; }
    });
    TICKETS.forEach(t => {
        if (t.customer_org_id) return;
        const id = getOrderById(t.order_id)?.customer_org_id || matchCustomerOrgId(t.customer_name);
        if (id) { t.customer_org_id = id; changed++; }
    });
    return changed;
}

// An unlinked customer is shown, not left silently null — otherwise it looks
// connected until that customer signs in and finds nothing.
function orderCustomerOrgCell(o) {
    const org = getOrgById(o.customer_org_id);
    if (org) return `<span class="badge badge-customer"><i class="ph ph-buildings"></i> ${esc(org.name)}</span>`;
    const actions = [
        hasPermission('organization.c') ? `<button onclick="confirmCreateCustomerOrgFromOrder('${o.id}')" class="btn-secondary text-xs" style="padding:3px 9px">Create organization</button>` : '',
        hasPermission('order.u') && getCustomerOrgs().length ? `<button onclick="showLinkCustomerOrgModal('${o.id}')" class="btn-secondary text-xs" style="padding:3px 9px">Link to existing</button>` : '',
    ].join('');
    return `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end"><span class="badge badge-amber" title="No organization is named exactly “${esc(o.customer_name)}”">Not linked</span>${actions}</span>`;
}

function confirmCreateCustomerOrgFromOrder(orderId) {
    const o = getOrderById(orderId);
    if (!o) return;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">Create customer organization?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 20px;line-height:1.6">Creates <strong style="color:#1d1d1f">${esc(o.customer_name)}</strong> as a customer organization. Every order and ticket under exactly this name links to it.</p>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button onclick="showOrderDetail('${o.id}')" class="btn-secondary">Cancel</button>
                <button onclick="createCustomerOrgFromOrder('${o.id}')" class="btn-primary"><i class="ph ph-buildings"></i> Create</button>
            </div>
        </div>`);
}

function createCustomerOrgFromOrder(orderId) {
    const o = getOrderById(orderId);
    if (!o) return;
    const name = o.customer_name.trim();
    // Org names are the match key, so they stay unique across every type.
    if (ORGS.some(x => x.name.toLowerCase() === name.toLowerCase())) {
        showToast(`An organization named ${name} already exists. Link to it instead.`, 'error');
        return;
    }
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        ORGS.push({ id: `org-${Date.now()}`, name, types: ['CUSTOMER'], vendor_type: null, status: 'active',
            contact_email: '', note: '', created_at: now, updated_at: now });
        const linked = backfillCustomerOrgIds();
        logActivity('Organization created', name, `Customer · from ${o.order_no} · ${linked} record${linked === 1 ? '' : 's'} linked`);
    });
    if (!ok) return;
    showOrderDetail(orderId);
    showToast(`${name} created and linked`);
}

function showLinkCustomerOrgModal(orderId) {
    const o = getOrderById(orderId);
    if (!o) return;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">Link to an existing organization</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">${esc(o.order_no)} names the customer <strong style="color:#1d1d1f">${esc(o.customer_name)}</strong>. The name stays as typed; the order and its tickets link to the organization you pick.</p>
            <label class="field-label" for="link-org-select">Customer organization</label>
            <select id="link-org-select" class="input-field">
                ${getCustomerOrgs().map(org => `<option value="${org.id}">${esc(org.name)}</option>`).join('')}
            </select>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrderDetail('${o.id}')" class="btn-secondary">Cancel</button>
                <button onclick="linkOrderCustomerOrg('${o.id}')" class="btn-primary"><i class="ph ph-link-simple"></i> Link</button>
            </div>
        </div>`, 'md');
}

function linkOrderCustomerOrg(orderId) {
    const o = getOrderById(orderId);
    const org = getOrgById(document.getElementById('link-org-select')?.value);
    if (!o || !org) return;
    const ok = commitPortalMutation(() => {
        o.customer_org_id = org.id;
        o.updated_at = new Date().toISOString();
        // The order's tickets belong to the same customer.
        TICKETS.filter(t => t.order_id === o.id).forEach(t => { t.customer_org_id = org.id; });
        logActivity('Order linked', o.order_no, `Customer “${o.customer_name}” → ${org.name}`);
    });
    if (!ok) return;
    showOrderDetail(orderId);
    showToast(`${o.order_no} linked to ${org.name}`);
}

// ── Detail ──

function showOrderDetail(id) {
    const o = getOrderById(id);
    if (!o) return;
    const lines = getOrderLines(id);
    const row = (label, value) => `
        <div style="display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #f5f5f7">
            <span style="font-size:12.5px;color:#86868b">${label}</span>
            <span style="font-size:13px;color:#1d1d1f;text-align:right">${value}</span>
        </div>`;

    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:6px">
                <div>
                    <div style="font-size:18px;font-weight:700;color:#1d1d1f">${esc(o.order_no)}</div>
                    <div style="font-size:13px;color:#86868b;margin-top:2px">${esc(o.customer_name)}</div>
                </div>
                ${orderStatusBadge(o.status)}
            </div>

            <div style="margin-top:16px">
                ${isOperatorView() ? row('Customer organization', orderCustomerOrgCell(o)) : ''}
                ${row('Contract No', esc(o.contract_no || '—'))}
                ${row('Order date', esc(o.order_date || '—'))}
                ${row('HW supplier', esc(o.hw_supplier_name || '—'))}
                ${row('SW supplier', esc(o.sw_supplier_name || '—'))}
                ${row('System integrator', esc(o.si_name || '—'))}
                ${row('Sales contact', esc(o.sales_contact || '—'))}
                ${o.notes ? row('Notes', esc(o.notes)) : ''}
            </div>

            ${orderDocSection(o)}

            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;margin:20px 0 8px">Order Lines</div>
            ${lines.map(l => {
                const parent = l.parent_line_id ? lines.find(x => x.id === l.parent_line_id) : null;
                return `
            <div style="border:1px solid var(--border-light);border-radius:10px;padding:12px 14px;margin-bottom:10px${parent ? ';margin-left:24px' : ''}">
                ${parent ? `<div style="font-size:11.5px;color:#86868b;margin-bottom:6px"><i class="ph ph-arrow-elbow-down-right"></i> Bundled with line ${parent.line_no} · ${esc(parent.product_name)}</div>` : ''}
                <div style="display:flex;align-items:center;gap:10px">
                    <span class="badge ${l.scope === 'HW' ? 'badge-hw' : 'badge-sw'}">${l.scope}</span>
                    <span style="font-size:13px;font-weight:600;color:#1d1d1f">${esc(l.product_name)}</span>
                    ${l.version ? `<span style="font-size:12.5px;color:#86868b">v${esc(l.version)}</span>` : ''}
                    <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
                        ${l.sla_plan ? `<span class="badge badge-blue">SLA ${esc(l.sla_plan)}</span>` : ''}
                        <span style="font-size:12.5px;color:#86868b">Qty ${l.qty}</span>
                        ${o.status === 'CONFIRMED' && canCreateTickets() ? `<button onclick="closeModal();showTicketCreateModal({ lineId: '${l.id}' })" class="btn-secondary text-xs" style="padding:4px 10px" title="Open a service ticket on this line"><i class="ph ph-headset"></i> Open ticket</button>` : ''}
                    </span>
                </div>
                ${getLineTickets(l.id).length ? `<div style="font-size:12px;color:#86868b;margin-top:6px"><i class="ph ph-ticket"></i> ${getLineTickets(l.id).length} ticket${getLineTickets(l.id).length === 1 ? '' : 's'} on this line · <a href="#" onclick="event.preventDefault();closeModal();openServiceDeskForOrder('${o.id}')" style="color:#1432E6;font-weight:600">view</a></div>` : ''}
                ${l.scope === 'SW' && (l.license_start || l.license_end || l.supplier_name) ? `
                <div style="font-size:12.5px;color:#86868b;margin-top:6px">${l.license_start || l.license_end ? `License ${esc(l.license_start || '?')} → ${esc(l.license_end || '?')}` : ''}${l.supplier_name ? `${l.license_start || l.license_end ? ' · ' : ''}Supplier ${esc(l.supplier_name)}` : ''}</div>` : ''}
                ${l.scope === 'HW' && l.warranty_months ? `
                <div style="font-size:12.5px;color:#86868b;margin-top:6px">Warranty ${l.warranty_months} months${l.warranty_start ? ` · ${esc(l.warranty_start)} → ${esc(l.warranty_end || '?')}` : ' · starts on shipment'}</div>` : ''}
                ${(l.license_keys || []).length ? `
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                    ${l.license_keys.map(lk => `<span style="display:inline-flex;align-items:center;gap:6px">${lk.key
                        ? `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f5f5f7;border-radius:6px;padding:3px 8px;color:#1d1d1f">${esc(lk.key)}</span>`
                        : '<span class="badge badge-amber">Key missing</span>'}${parent ? `<span style="font-size:11.5px;color:#86868b">→ ${esc(licenseUnitLabel(parent, lk.unit))}</span>` : ''}</span>`).join('')}
                </div>` : ''}
                ${l.scope === 'SW' && o.status === 'CONFIRMED' && canUpdateOrders() ? `
                <div style="margin-top:8px"><button onclick="showLicenseAdjustModal('${l.id}')" class="btn-secondary text-xs" style="padding:4px 10px"><i class="ph ph-key"></i> Adjust license</button></div>` : ''}
                ${l.serial_nos.length ? `
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                    ${l.serial_nos.map(sn => sn.trim()
                        ? `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f5f5f7;border-radius:6px;padding:3px 8px;color:#1d1d1f">${esc(sn)}</span>`
                        : '<span class="badge badge-amber">Serial missing</span>').join('')}
                </div>` : ''}
                ${l.bom.length ? `
                <div style="margin-top:10px;overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse">
                        <thead><tr>
                            <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 10px 4px 0">Component</th>
                            <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 10px 4px 0">Brand</th>
                            <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:left;padding:0 10px 4px 0">Model</th>
                            <th style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;text-align:right;padding:0 0 4px 0">Qty</th>
                        </tr></thead>
                        <tbody>
                            ${l.bom.map(b => `
                            <tr>
                                <td style="font-size:12.5px;color:#1d1d1f;padding:3px 10px 3px 0;white-space:nowrap">${esc(b.component_type)}</td>
                                <td style="font-size:12.5px;color:#86868b;padding:3px 10px 3px 0;white-space:nowrap">${esc(b.brand || '—')}</td>
                                <td style="font-size:12.5px;color:#1d1d1f;padding:3px 10px 3px 0">${esc(b.model)}</td>
                                <td style="font-size:12.5px;color:#1d1d1f;padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">${b.qty}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>` : ''}
            </div>`;
            }).join('')}

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap">
                ${o.status === 'DRAFT' && canUpdateOrders() ? `<button onclick="closeModal();showOrderModal('${o.id}')" class="btn-secondary text-xs"><i class="ph ph-pencil-simple"></i> Edit</button>` : ''}
                ${o.status !== 'CANCELLED' && canUpdateOrders() ? `<button onclick="confirmCancelOrder('${o.id}')" class="btn-secondary text-xs"><i class="ph ph-x-circle"></i> Cancel order</button>` : ''}
                <button onclick="closeModal()" class="btn-primary text-xs">Close</button>
            </div>
        </div>
    `, true);
}

// ── Cancel ──
// Cancelling is a status change, not a delete: the order stays on file for
// reference, matching how the backend spec retires records by status.

function confirmCancelOrder(id) {
    const o = getOrderById(id);
    if (!o || o.status === 'CANCELLED') return;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">Cancel ${esc(o.order_no)}?</h3>
            <p style="font-size:13px;color:#86868b;line-height:1.6;margin:0 0 18px">
                The order stays on file as cancelled. This cannot be undone from the UI.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button onclick="showOrderDetail('${o.id}')" class="btn-secondary text-xs">Keep order</button>
                <button onclick="cancelOrder('${o.id}')" class="btn-primary text-xs">Cancel order</button>
            </div>
        </div>
    `);
}

function cancelOrder(id) {
    const o = getOrderById(id);
    if (!o) return;
    const ok = commitPortalMutation(() => {
        o.status = 'CANCELLED';
        o.updated_at = new Date().toISOString();
        logActivity('Order cancelled', o.order_no, o.customer_name);
    });
    if (!ok) return;
    closeModal();
    renderOrders();
    showToast(`${o.order_no} cancelled`);
}

// ═══════════════════════════════════════════════════════════════════
// ORGANIZATIONS — operator and customer orgs, their members and roles
// (docs/ORG_MANAGEMENT_PLAN.md). Vendor orgs stay data-only this round
// and never show here. An org's type is fixed at creation: it sets the
// ceiling every role in the org is built against.
// ═══════════════════════════════════════════════════════════════════

let orgDetailTab = 'profile';
// Accounts span organizations, so the tab is the desk's alone: a customer
// admin manages people through its own org's Members tab.
let orgPageTab = 'orgs';

function isManagedOrg(org) { return (org?.types || []).some(t => ENABLED_ORG_TYPES.includes(t)); }
function isIndividualOrg(org) { return orgHasType(org, 'CUSTOMER') && org?.customer_type === 'INDIVIDUAL'; }
// An individual customer is the account: there is nobody to add and no role
// to hand out, so member management is off for everyone, the desk included.
function orgAllowsMembers(org) { return !isIndividualOrg(org); }
function orgTypeBadge(org) {
    if (orgHasType(org, 'OPERATOR')) return '<span class="badge badge-blue">Operator</span>';
    return `<span style="display:inline-flex;gap:4px;white-space:nowrap"><span class="badge badge-customer">Customer</span><span class="badge badge-zinc">${isIndividualOrg(org) ? 'Individual' : 'Enterprise'}</span></span>`;
}
function orgStatusBadge(org) {
    return org.status === 'active' ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-zinc">Inactive</span>';
}
function getOrgRoles(orgId) { return ROLES.filter(r => r.org_id === orgId).sort((a, b) => a.name.localeCompare(b.name)); }
function getOrgBindings(orgId) {
    const roleIds = new Set(getOrgRoles(orgId).map(r => r.id));
    return ROLE_BINDINGS.filter(b => roleIds.has(b.role_id));
}
// One row per account, carrying every role it holds in this org.
function getOrgMembers(orgId) {
    const byUser = new Map();
    getOrgBindings(orgId).forEach(b => {
        const user = USERS.find(u => u.id === b.user_id);
        if (!user) return;
        if (!byUser.has(user.id)) byUser.set(user.id, { user, bindings: [] });
        byUser.get(user.id).bindings.push(b);
    });
    return [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
}
function getOrgOrders(org) { return orgHasType(org, 'CUSTOMER') ? ORDERS.filter(o => o.customer_org_id === org.id) : []; }

// The desk manages every operator and customer org; anyone else only their own.
function getScopedOrgs() {
    const list = ORGS.filter(isManagedOrg);
    return isOperatorView() ? list : list.filter(o => o.id === activeOrgId());
}
function canSeeOrg(org) { return !!org && getScopedOrgs().some(o => o.id === org.id); }
// Creating orgs and editing their profile are desk decisions; a customer
// admin's organization grants cover its own members.
function canCreateOrgs() { return isOperatorView() && hasPermission('organization.c'); }
function canEditOrgProfile() { return isOperatorView() && hasPermission('organization.u'); }
function canAddMembers() { return hasPermission('organization.c'); }
function canEditMembers() { return hasPermission('organization.u'); }
function canRemoveMembers() { return hasPermission('organization.d'); }

function setOrgFilter(val) {
    document.getElementById('org-filter-type').value = val;
    document.querySelectorAll('#org-filter-tabs .filter-tab').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    renderOrganizations();
}

function getFilteredOrgs() {
    const type = document.getElementById('org-filter-type')?.value || '';
    const q = (document.getElementById('org-search')?.value || '').trim().toLowerCase();
    return getScopedOrgs().filter(org => {
        if (type === 'INDIVIDUAL' || type === 'ENTERPRISE') {
            if (!orgHasType(org, 'CUSTOMER') || (org.customer_type || 'ENTERPRISE') !== type) return false;
        } else if (type && !orgHasType(org, type)) return false;
        if (q && ![org.name, org.contact_email].some(v => (v || '').toLowerCase().includes(q))) return false;
        return true;
    }).sort((a, b) => Number(orgHasType(b, 'OPERATOR')) - Number(orgHasType(a, 'OPERATOR')) || a.name.localeCompare(b.name));
}

function canSeeAccountsTab() { return isOperatorView() && hasPermission('organization.r'); }
function setOrgPageTab(tab) {
    orgPageTab = tab === 'accounts' && canSeeAccountsTab() ? 'accounts' : 'orgs';
    renderOrganizations();
}

function renderOrganizations() {
    if (orgPageTab === 'accounts' && !canSeeAccountsTab()) orgPageTab = 'orgs';
    const onAccounts = orgPageTab === 'accounts';
    const pageTabs = document.getElementById('org-page-tabs');
    if (pageTabs) {
        pageTabs.style.display = canSeeAccountsTab() ? '' : 'none';
        pageTabs.innerHTML = canSeeAccountsTab() ? `
            <button class="page-tab ${onAccounts ? '' : 'active'}" onclick="setOrgPageTab('orgs')">Organizations (${getScopedOrgs().length})</button>
            <button class="page-tab ${onAccounts ? 'active' : ''}" onclick="setOrgPageTab('accounts')">Accounts (${USERS.length})</button>` : '';
    }
    const orgTable = document.getElementById('orgs-tbody')?.closest('.overflow-x-auto');
    const accountsTable = document.getElementById('accounts-table-wrap');
    if (orgTable) orgTable.style.display = onAccounts ? 'none' : '';
    if (accountsTable) accountsTable.style.display = onAccounts ? '' : 'none';
    const search = document.getElementById('org-search');
    if (search) search.placeholder = onAccounts ? 'Search name or email...' : 'Search name or contact email...';
    // The header and the New Organization button describe the open tab.
    if (currentView === 'organizations') {
        setPageHeader('Organizations',
            onAccounts
                ? 'Every account and the organizations it holds roles in. Accounts span organizations, so this list is the desk\'s.'
                : (isOperatorView()
                    ? 'AISO and customer organizations, their members and roles. Each type sets what its roles can be granted.'
                    : 'Your organization, its members and roles.'),
            !onAccounts && canCreateOrgs() ? `<div style="white-space:nowrap"><button onclick="showOrgModal()" class="btn-primary"><i class="ph ph-plus"></i> New Organization</button></div>` : '');
    }
    // The type filter belongs to the organization list, not to accounts.
    const tabs = document.getElementById('org-filter-tabs');
    if (tabs) tabs.style.display = isOperatorView() && !onAccounts ? '' : 'none';
    if (onAccounts) { renderAccounts(); return; }
    const list = getFilteredOrgs();
    const searching = !!(document.getElementById('org-search')?.value || '').trim();
    document.getElementById('orgs-tbody').innerHTML = list.length ? list.map(org => {
        const members = getOrgMembers(org.id).length;
        const roles = getOrgRoles(org.id).length;
        const orders = orgHasType(org, 'CUSTOMER') ? getOrgOrders(org).length : null;
        return `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showOrgDetail('${org.id}')">
            <td><span style="font-weight:600;font-size:13px;color:#1d1d1f">${esc(org.name)}</span>
                ${org.contact_email ? `<div style="font-size:11.5px;color:#86868b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(org.contact_email)}">${esc(org.contact_email)}</div>` : ''}</td>
            <td>${orgTypeBadge(org)}</td>
            <td><span style="font-size:13px;color:#86868b">${members}</span></td>
            <td><span style="font-size:13px;color:#86868b">${roles}</span></td>
            <td><span style="font-size:13px;color:#86868b">${orders === null ? '—' : orders}</span></td>
            <td>${orgStatusBadge(org)}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <div class="flex items-center gap-0.5 justify-end">
                    <button onclick="showOrgDetail('${org.id}')" class="btn-ghost" title="Details"><i class="ph ph-info"></i></button>
                    ${canEditOrgProfile() ? `<button onclick="showOrgModal('${org.id}')" class="btn-ghost" title="Edit"><i class="ph ph-pencil-simple"></i></button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-center py-16">${emptyState(
        'ph-buildings',
        searching ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searching && canCreateOrgs() ? '<div class="flex items-center gap-2 justify-center mt-1"><button onclick="showOrgModal()" class="btn-primary text-xs"><i class="ph ph-plus"></i> New Organization</button></div>' : ''
    )}</td></tr>`;
}

// ── Accounts (desk only) ──
// One row per account, showing every organization and role it holds. This is
// the only place the one-account-many-organizations shape is visible at once.

function getUserBindings(userId) {
    return ROLE_BINDINGS.filter(b => b.user_id === userId).map(b => {
        const role = ROLES.find(r => r.id === b.role_id);
        const org = role ? getOrgById(role.org_id) : null;
        return { binding: b, role, org };
    }).filter(x => x.org && isManagedOrg(x.org));
}

// One chip per organization, listing the roles held there — repeating the
// organization name once per role reads as noise as soon as someone holds
// more than one.
function accountOrgChips(held) {
    const byOrg = new Map();
    held.forEach(h => {
        if (!byOrg.has(h.org.id)) byOrg.set(h.org.id, { org: h.org, roles: [] });
        byOrg.get(h.org.id).roles.push(h.role.name);
    });
    return [...byOrg.values()].map(({ org, roles }) => {
        const label = `${org.name} · ${roles.sort().join(', ')}`;
        return `<span class="badge ${orgHasType(org, 'OPERATOR') ? 'badge-blue' : 'badge-customer'}" style="display:inline-block;max-width:22rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left" title="${esc(label)}">${esc(label)}</span>`;
    }).join('');
}

function getFilteredAccounts() {
    const q = (document.getElementById('org-search')?.value || '').trim().toLowerCase();
    return USERS
        .filter(u => !q || [u.name, u.email].some(v => (v || '').toLowerCase().includes(q)))
        .sort((a, b) => Number(b.is_super_admin) - Number(a.is_super_admin) || a.name.localeCompare(b.name));
}

function canManageAccounts() { return isOperatorView() && hasPermission('organization.u'); }

function renderAccounts() {
    const list = getFilteredAccounts();
    const searching = !!(document.getElementById('org-search')?.value || '').trim();
    document.getElementById('accounts-tbody').innerHTML = list.length ? list.map(user => {
        const held = getUserBindings(user.id);
        const disabled = user.status !== 'active';
        return `
        <tr>
            <td><div style="display:flex;align-items:center;gap:10px">
                <span style="width:28px;height:28px;border-radius:50%;background:#eef1ff;color:#1432E6;font-weight:700;font-size:10.5px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${esc(getUserInitials(user.name))}</span>
                <span style="min-width:0"><span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(user.name)}</span>
                <span style="display:block;font-size:11.5px;color:#86868b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(user.email)}">${esc(user.email)}</span></span>
            </div></td>
            <td>${user.is_super_admin
                ? '<span class="badge badge-super">Super Admin</span> <span style="font-size:12px;color:#86868b">System account · belongs to no organization</span>'
                : (held.length
                    ? `<span style="display:flex;gap:4px;flex-wrap:wrap">${accountOrgChips(held)}</span>`
                    : '<span class="badge badge-amber" title="This account cannot sign in until it holds a role">No role</span>')}</td>
            <td>${disabled ? '<span class="badge badge-zinc">Disabled</span>' : '<span class="badge badge-green">Active</span>'}</td>
            <td class="text-right">
                ${user.is_super_admin || !canManageAccounts() ? ''
                    : `<button onclick="confirmToggleAccount('${user.id}')" class="btn-ghost" title="${disabled ? 'Re-enable account' : 'Disable account'}"><i class="ph ${disabled ? 'ph-lock-open' : 'ph-prohibit'}"></i></button>`}
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="4" class="text-center py-16">${emptyState('ph-user', searching ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA, '')}</td></tr>`;
}

function confirmToggleAccount(userId) {
    const user = USERS.find(u => u.id === userId);
    if (!user || user.is_super_admin || !canManageAccounts()) return;
    if (!viewAsBindingId && user.id === currentUser?.id) { showToast('You cannot disable the account you are signed in with.', 'error'); return; }
    const disabling = user.status === 'active';
    const held = getUserBindings(user.id);
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">${disabling ? 'Disable' : 'Re-enable'} ${esc(user.name)}?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 12px;line-height:1.6">${disabling
                ? `${esc(user.email)} will not be able to sign in. Its ${held.length} role${held.length === 1 ? '' : 's'} stay attached, so re-enabling restores the same access.`
                : `${esc(user.email)} will be able to sign in again under its existing role${held.length === 1 ? '' : 's'}.`}</p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="toggleAccountStatus('${user.id}')" class="btn-primary" ${disabling ? 'style="background:#dc2626"' : ''}><i class="ph ${disabling ? 'ph-prohibit' : 'ph-lock-open'}"></i> ${disabling ? 'Disable' : 'Re-enable'}</button>
            </div>
        </div>`);
}

function toggleAccountStatus(userId) {
    const user = USERS.find(u => u.id === userId);
    if (!user || user.is_super_admin || !canManageAccounts()) return;
    if (!viewAsBindingId && user.id === currentUser?.id) return;
    const next = user.status === 'active' ? 'disabled' : 'active';
    const ok = commitPortalMutation(() => {
        user.status = next;
        user.updated_at = new Date().toISOString();
        logActivity(next === 'active' ? 'Account re-enabled' : 'Account disabled', user.name, user.email);
    });
    if (!ok) return;
    closeModal();
    renderOrganizations();
    showToast(`${user.name} ${next === 'active' ? 're-enabled' : 'disabled'}`);
}

// ── Create / edit ──

function showOrgModal(orgId = null) {
    const org = orgId ? getOrgById(orgId) : null;
    if (org ? !canEditOrgProfile() : !canCreateOrgs()) return;
    const isOperator = orgHasType(org, 'OPERATOR');
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 18px">${org ? `Edit ${esc(org.name)}` : 'New Organization'}</h3>
            <div style="display:grid;gap:14px">
                <div>
                    <label class="field-label" for="org-name">Name <span class="req">*</span></label>
                    <input id="org-name" class="input-field" maxlength="100" autocomplete="off" value="${esc(org?.name || '')}" placeholder="As it appears on orders">
                    <div class="field-hint">Orders whose customer name matches exactly link to this organization.</div>
                </div>
                <div>
                    <label class="field-label" for="org-type">Type <span class="req">*</span></label>
                    ${org ? `<div style="padding:4px 0">${orgTypeBadge(org)}</div>
                    <div class="field-hint">Fixed after creation: the type sets what any role in this organization can be granted.</div>`
                    : `<select id="org-type" class="input-field" onchange="onOrgTypeChange()">
                        <option value="CUSTOMER_ENTERPRISE">Customer · Enterprise</option>
                        <option value="CUSTOMER_INDIVIDUAL">Customer · Individual</option>
                        <option value="OPERATOR">Operator</option>
                    </select>
                    <div class="field-hint">Fixed after creation. An individual customer is one person: no members, no roles to manage.</div>`}
                </div>
                <div id="org-person-wrap" style="display:none;border-top:1px solid var(--border-light);padding-top:14px">
                    <div class="field-label" style="margin-bottom:8px">The person <span class="req">*</span></div>
                    <label class="field-label" for="org-person-name">Name</label>
                    <input id="org-person-name" class="input-field" maxlength="100" autocomplete="off" placeholder="Full name">
                    <div style="height:10px"></div>
                    <label class="field-label" for="org-person-email">Email</label>
                    <input id="org-person-email" class="input-field" type="email" maxlength="100" autocomplete="off" placeholder="name@example.com">
                    <div class="field-hint">Creates the account and its Owner role. An email already on file is reused.</div>
                </div>
                <div>
                    <label class="field-label" for="org-contact">Contact email</label>
                    <input id="org-contact" class="input-field" type="email" maxlength="100" autocomplete="off" value="${esc(org?.contact_email || '')}" placeholder="Optional">
                </div>
                <div>
                    <label class="field-label" for="org-note">Note</label>
                    <textarea id="org-note" class="input-field" rows="2" maxlength="500" placeholder="Optional">${esc(org?.note || '')}</textarea>
                </div>
                ${org && !isOperator ? `<div>
                    <label class="field-label" for="org-status">Status</label>
                    <select id="org-status" class="input-field">
                        <option value="active" ${org.status === 'active' ? 'selected' : ''}>Active</option>
                        <option value="inactive" ${org.status !== 'active' ? 'selected' : ''}>Inactive</option>
                    </select>
                    <div class="field-hint">Members of an inactive organization cannot sign in under its roles.</div>
                </div>` : ''}
            </div>
            <p id="org-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin:14px 0 0"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="closeModal()" class="btn-secondary">Cancel</button>
                <button onclick="saveOrg(${org ? `'${org.id}'` : 'null'})" class="btn-primary"><i class="ph ph-check"></i> ${org ? 'Save' : 'Create'}</button>
            </div>
        </div>`, 'md');
    document.getElementById('org-name')?.focus();
}

function onOrgTypeChange() {
    const wrap = document.getElementById('org-person-wrap');
    if (wrap) wrap.style.display = document.getElementById('org-type')?.value === 'CUSTOMER_INDIVIDUAL' ? '' : 'none';
}

function saveOrg(orgId = null) {
    const org = orgId ? getOrgById(orgId) : null;
    const name = (document.getElementById('org-name')?.value || '').trim();
    const contact = (document.getElementById('org-contact')?.value || '').trim();
    const note = (document.getElementById('org-note')?.value || '').trim();
    const err = document.getElementById('org-error');
    const fail = msg => { err.textContent = msg; err.style.display = 'block'; };
    if (!name) return fail('Name is required.');
    // Names are the match key for free-text orders, so they stay unique across every type.
    if (ORGS.some(o => o.id !== orgId && o.name.toLowerCase() === name.toLowerCase())) return fail(`An organization named ${name} already exists.`);
    if (contact && validateLoginEmail(contact)) return fail('Enter a valid contact email.');
    const choice = document.getElementById('org-type')?.value || '';
    const individual = !org && choice === 'CUSTOMER_INDIVIDUAL';
    const personName = (document.getElementById('org-person-name')?.value || '').trim();
    const personEmail = (document.getElementById('org-person-email')?.value || '').trim();
    if (individual) {
        if (!personName) return fail("Enter the person's name.");
        const personEmailError = validateLoginEmail(personEmail);
        if (personEmailError) return fail(personEmailError);
    }
    const now = new Date().toISOString();
    let linked = 0;
    const ok = commitPortalMutation(() => {
        if (org) {
            const status = document.getElementById('org-status')?.value || org.status;
            Object.assign(org, { name, contact_email: contact, note, status, updated_at: now });
        } else {
            const isOperator = choice === 'OPERATOR';
            const record = { id: `org-${Date.now()}`, name, types: [isOperator ? 'OPERATOR' : 'CUSTOMER'], vendor_type: null,
                customer_type: isOperator ? null : (individual ? 'INDIVIDUAL' : 'ENTERPRISE'), status: 'active',
                contact_email: contact, note, created_at: now, updated_at: now };
            ORGS.push(record);
            // An individual customer arrives complete: the org, its one role
            // and the person's account are the same act.
            if (individual) {
                const role = { id: `r-${Date.now()}`, org_id: record.id, name: 'Owner', description: 'The individual customer themselves.',
                    permissions: ['order.r', 'ticket.c', 'ticket.r', 'ticket.u', 'asset.r', 'activity_log.r'], created_at: now, updated_at: now };
                ROLES.push(role);
                let user = findUserByEmail(personEmail);
                if (!user) {
                    user = { id: `u-${Date.now()}`, name: personName, email: personEmail, status: 'active', is_super_admin: false, created_at: now, updated_at: now };
                    USERS.push(user);
                }
                ROLE_BINDINGS.push({ id: `rb-${Date.now()}`, user_id: user.id, role_id: role.id, status: 'active', created_at: now });
            }
        }
        linked = backfillCustomerOrgIds();
        logActivity(org ? 'Organization updated' : 'Organization created', name,
            [org ? '' : (individual ? 'Customer · Individual' : choice === 'OPERATOR' ? 'Operator' : 'Customer · Enterprise'),
             linked ? `${linked} order/ticket record${linked === 1 ? '' : 's'} linked` : ''].filter(Boolean).join(' · '));
    });
    if (!ok) return;
    closeModal();
    renderOrganizations();
    showToast(`${name} ${org ? 'saved' : 'created'}${linked ? ` · ${linked} record${linked === 1 ? '' : 's'} linked` : ''}`);
}

// ── Detail ──

function showOrgDetail(orgId, tab = null) {
    const org = getOrgById(orgId);
    if (!canSeeOrg(org)) return;
    if (tab) orgDetailTab = tab;
    // Tabs differ by customer type, so a stale tab falls back to Profile.
    if (orgAllowsMembers(org) ? orgDetailTab === 'account' : ['members', 'roles'].includes(orgDetailTab)) orgDetailTab = 'profile';
    const members = getOrgMembers(org.id);
    const roles = getOrgRoles(org.id);
    const tabBtn = (key, label) => `<button class="filter-tab ${orgDetailTab === key ? 'active' : ''}" onclick="showOrgDetail('${org.id}', '${key}')">${label}</button>`;
    const body = orgDetailTab === 'members' ? orgMembersTab(org, members, roles)
        : orgDetailTab === 'roles' ? orgRolesTab(org, roles)
        : orgDetailTab === 'account' ? orgAccountTab(org, members)
        : orgProfileTab(org);
    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
                <div>
                    <div style="font-size:18px;font-weight:700;color:#1d1d1f">${esc(org.name)}</div>
                    <div style="display:flex;gap:6px;margin-top:6px">${orgTypeBadge(org)}${orgStatusBadge(org)}</div>
                </div>
                ${canEditOrgProfile() ? `<button onclick="showOrgModal('${org.id}')" class="btn-secondary text-xs"><i class="ph ph-pencil-simple"></i> Edit</button>` : ''}
            </div>
            <div class="filter-tabs" style="margin:18px 0 14px">
                ${tabBtn('profile', 'Profile')}
                ${orgAllowsMembers(org) ? `${tabBtn('members', `Members (${members.length})`)}
                ${tabBtn('roles', `Roles (${roles.length})`)}` : tabBtn('account', 'Account')}
            </div>
            ${body}
            <div style="display:flex;justify-content:flex-end;margin-top:20px">
                <button onclick="closeModal()" class="btn-primary">Close</button>
            </div>
        </div>`, 'lg');
}

function orgProfileTab(org) {
    const row = (label, value) => `
        <div style="display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #f5f5f7">
            <span style="font-size:12.5px;color:#86868b">${label}</span>
            <span style="font-size:13px;color:#1d1d1f;text-align:right">${value}</span>
        </div>`;
    const orders = getOrgOrders(org);
    const tickets = orgHasType(org, 'CUSTOMER') ? TICKETS.filter(t => t.customer_org_id === org.id).length : 0;
    return `
        ${row('Contact email', esc(org.contact_email || '—'))}
        ${row('Created', esc((org.created_at || '').slice(0, 10) || '—'))}
        ${org.note ? row('Note', esc(org.note)) : ''}
        ${orgHasType(org, 'OPERATOR') ? `
        <div class="field-hint" style="margin-top:12px">AISO is the single service window. The Super Admin is a system account: it belongs to no organization, holds no role here, and is never counted as a member.</div>` : `
        ${row('Tickets', String(tickets))}
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;margin:18px 0 8px">Linked orders</div>
        ${orders.length ? orders.map(o => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f5f7">
            <a href="#" onclick="event.preventDefault();showOrderDetail('${o.id}')" style="font-size:13px;font-weight:600;color:#1432E6;text-decoration:none">${esc(o.order_no)}</a>
            <span style="font-size:12.5px;color:#86868b">${esc(o.order_date || '')}</span>
            <span style="margin-left:auto">${orderStatusBadge(o.status)}</span>
        </div>`).join('') : '<div style="font-size:12.5px;color:#86868b">No orders are linked yet. Orders link when their customer name matches this organization exactly.</div>'}`}`;
}

function orgMembersTab(org, members, roles) {
    const noRoles = !roles.length;
    return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
            <div style="font-size:12.5px;color:#86868b">Each member holds one or more of this organization's roles.</div>
            ${canAddMembers() ? `<button onclick="showAddMemberModal('${org.id}')" class="btn-primary text-xs" style="white-space:nowrap" ${noRoles ? 'disabled title="Create a role first"' : ''}><i class="ph ph-user-plus"></i> Add member</button>` : ''}
        </div>
        ${noRoles ? `<div style="font-size:12.5px;color:#9a3412;background:#fff7ed;border-radius:10px;padding:10px 12px;margin-bottom:10px">This organization has no roles yet. Create one under the Roles tab before adding members.</div>` : ''}
        ${members.length ? `<div style="border:1px solid var(--border-light);border-radius:12px;overflow:hidden">${members.map(({ user, bindings }, i) => `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;${i < members.length - 1 ? 'border-bottom:1px solid var(--border-light)' : ''}">
            <span style="width:30px;height:30px;border-radius:50%;background:#eef1ff;color:#1432E6;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${esc(getUserInitials(user.name))}</span>
            <span style="flex:1;min-width:0">
                <span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(user.name)}${user.status !== 'active' ? ' <span class="badge badge-zinc">Disabled</span>' : ''}</span>
                <span style="display:block;font-size:12px;color:#86868b">${esc(user.email)}</span>
            </span>
            <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${bindings.map(b => `<span class="badge badge-zinc">${esc(ROLES.find(r => r.id === b.role_id)?.name || '')}</span>`).join('')}</span>
            ${canEditMembers() ? `<button onclick="showEditMemberModal('${org.id}', '${user.id}')" class="btn-ghost" title="Change roles"><i class="ph ph-pencil-simple"></i></button>` : ''}
            ${canRemoveMembers() ? `<button onclick="confirmRemoveMember('${org.id}', '${user.id}')" class="btn-ghost" title="Remove from organization"><i class="ph ph-user-minus"></i></button>` : ''}
        </div>`).join('')}</div>`
        : `<div style="padding:20px 0">${emptyState('ph-users', 'No members yet.', '')}</div>`}`;
}

function orgRolesTab(org, roles) {
    return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
            <div style="font-size:12.5px;color:#86868b">Roles are built here, one checkbox at a time, within what this organization's type allows.</div>
            ${canEditMembers() ? `<button onclick="showRoleModal('${org.id}')" class="btn-primary text-xs" style="white-space:nowrap"><i class="ph ph-plus"></i> New role</button>` : ''}
        </div>
        ${roles.length ? `<div style="border:1px solid var(--border-light);border-radius:12px;overflow:hidden">${roles.map((r, i) => {
        const holders = ROLE_BINDINGS.filter(b => b.role_id === r.id).length;
        const grants = effectivePermissions(r).length;
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;${i < roles.length - 1 ? 'border-bottom:1px solid var(--border-light)' : ''}">
            <span style="flex:1;min-width:0">
                <span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(r.name)}</span>
                ${r.description ? `<span style="display:block;font-size:12px;color:#86868b">${esc(r.description)}</span>` : ''}
            </span>
            <span style="font-size:12px;color:#86868b;white-space:nowrap">${grants} permission${grants === 1 ? '' : 's'} · ${holders} member${holders === 1 ? '' : 's'}</span>
            ${canEditMembers() ? `<button onclick="showRoleModal('${org.id}', '${r.id}')" class="btn-ghost" title="Edit role"><i class="ph ph-pencil-simple"></i></button>` : ''}
            ${canRemoveMembers() ? `<button onclick="confirmDeleteRole('${org.id}', '${r.id}')" class="btn-ghost" title="Delete role"><i class="ph ph-trash"></i></button>` : ''}
        </div>`;
    }).join('')}</div>` : `<div style="padding:20px 0">${emptyState('ph-identification-badge', 'No roles yet.',
        canEditMembers() ? `<div class="flex items-center gap-2 justify-center mt-1"><button onclick="showRoleModal('${org.id}')" class="btn-primary text-xs"><i class="ph ph-plus"></i> New role</button></div>` : '')}</div>`}`;
}

// ── Role editor (layer 2) ──
// The matrix offers every module, but a cell outside the org type's ceiling
// is disabled and stripped on save, so no role can be built past what the
// type allows. Reading is implied by writing: ticking C, U or D ticks R.

function permissionCellId(mod, action) { return `perm-${mod}-${action}`; }

function rolePermissionMatrix(org, checked = []) {
    const ceiling = orgCapabilities(org);
    const head = PERMISSION_ACTIONS.map(a => `<th style="width:52px;text-align:center;text-transform:uppercase">${a}</th>`).join('');
    const rows = PERMISSION_MODULES.map(mod => {
        const cells = PERMISSION_ACTIONS.map(a => {
            const key = `${mod.key}.${a}`;
            const allowed = ceiling.has(key);
            if (!allowed) return `<td style="text-align:center"><span title="${esc(orgTypeCeilingHint(org))}" style="color:#d2d2d7">—</span></td>`;
            return `<td style="text-align:center"><input type="checkbox" class="role-perm" id="${permissionCellId(mod.key, a)}" data-module="${mod.key}" data-action="${a}" value="${key}" ${checked.includes(key) ? 'checked' : ''} onchange="onRolePermissionToggle('${mod.key}', '${a}')"></td>`;
        }).join('');
        const anyAllowed = PERMISSION_ACTIONS.some(a => ceiling.has(`${mod.key}.${a}`));
        return `<tr style="${anyAllowed ? '' : 'opacity:.45'}"><td style="font-size:12.5px;color:#1d1d1f">${esc(mod.label)}</td>${cells}</tr>`;
    }).join('');
    return `<table class="data-table w-full" style="margin-top:6px"><thead><tr><th>Module</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function orgTypeCeilingHint(org) {
    if (orgHasType(org, 'OPERATOR')) return 'Not available to any role.';
    return isIndividualOrg(org) ? 'An individual customer cannot be granted this.' : 'A customer organization cannot be granted this.';
}

// Being able to change something without being able to see it is not a state
// worth allowing, so a write grant pulls read along with it.
function onRolePermissionToggle(mod, action) {
    if (action === 'r') return;
    const box = document.getElementById(permissionCellId(mod, action));
    const read = document.getElementById(permissionCellId(mod, 'r'));
    if (box?.checked && read && !read.checked) read.checked = true;
}

function showRoleModal(orgId, roleId = null) {
    const org = getOrgById(orgId);
    const role = roleId ? ROLES.find(r => r.id === roleId) : null;
    if (!canSeeOrg(org) || !orgAllowsMembers(org) || !canEditMembers()) return;
    const holders = role ? ROLE_BINDINGS.filter(b => b.role_id === role.id).length : 0;
    showModal(`
        <div style="padding:26px 28px;max-height:82vh;overflow-y:auto">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 4px">${role ? `Edit role · ${esc(role.name)}` : 'New role'}</h3>
            <div style="font-size:13px;color:#86868b;margin-bottom:16px">${esc(org.name)} · ${orgHasType(org, 'OPERATOR') ? 'Operator' : 'Customer'}${holders ? ` · ${holders === 1 ? '1 member holds' : `${holders} members hold`} this role` : ''}</div>
            <label class="field-label" for="role-name">Name <span class="req">*</span></label>
            <input id="role-name" class="input-field" maxlength="60" autocomplete="off" value="${esc(role?.name || '')}" placeholder="Service Agent">
            <div style="height:10px"></div>
            <label class="field-label" for="role-desc">Description</label>
            <input id="role-desc" class="input-field" maxlength="140" autocomplete="off" value="${esc(role?.description || '')}" placeholder="Optional — what this role is for">
            <div class="field-label" style="margin-top:16px">Permissions</div>
            <div class="field-hint">C create · R read · U update · D delete. A dash means this organization's type does not allow it.</div>
            ${rolePermissionMatrix(org, role ? [...role.permissions] : [])}
            <p id="role-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin:14px 0 0"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrgDetail('${org.id}', 'roles')" class="btn-secondary">Cancel</button>
                <button onclick="saveRole('${org.id}', ${role ? `'${role.id}'` : 'null'})" class="btn-primary"><i class="ph ph-check"></i> ${role ? 'Save' : 'Create'}</button>
            </div>
        </div>`, 'lg');
    document.getElementById('role-name')?.focus();
}

function saveRole(orgId, roleId = null) {
    const org = getOrgById(orgId);
    const role = roleId ? ROLES.find(r => r.id === roleId) : null;
    if (!canSeeOrg(org) || !orgAllowsMembers(org) || !canEditMembers()) return;
    const name = (document.getElementById('role-name')?.value || '').trim();
    const description = (document.getElementById('role-desc')?.value || '').trim();
    const err = document.getElementById('role-error');
    const fail = msg => { err.textContent = msg; err.style.display = 'block'; };
    if (!name) return fail('Name is required.');
    if (getOrgRoles(orgId).some(r => r.id !== roleId && r.name.toLowerCase() === name.toLowerCase())) return fail(`This organization already has a role named ${name}.`);
    const ceiling = orgCapabilities(org);
    const permissions = [...document.querySelectorAll('.role-perm:checked')].map(el => el.value).filter(p => ceiling.has(p));
    if (!permissions.length) return fail('Pick at least one permission.');
    // Changing the role you are acting under would rewrite the floor beneath
    // this session; the Super Admin previewing it is unaffected.
    const actingRole = !viewAsBindingId && activeRole();
    if (role && actingRole && actingRole.id === role.id) return fail('This is the role you are signed in under. Switch to another role before editing it.');
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        if (role) Object.assign(role, { name, description, permissions, updated_at: now });
        else ROLES.push({ id: `r-${Date.now()}`, org_id: orgId, name, description, permissions, created_at: now, updated_at: now });
        logActivity(role ? 'Role updated' : 'Role created', org.name, `${name} · ${permissions.length} permission${permissions.length === 1 ? '' : 's'}`);
    });
    if (!ok) return;
    showOrgDetail(orgId, 'roles');
    renderOrganizations();
    showToast(`${name} ${role ? 'saved' : 'created'}`);
}

function confirmDeleteRole(orgId, roleId) {
    const org = getOrgById(orgId);
    const role = ROLES.find(r => r.id === roleId);
    if (!canSeeOrg(org) || !role || !canRemoveMembers()) return;
    const holders = ROLE_BINDINGS.filter(b => b.role_id === roleId)
        .map(b => USERS.find(u => u.id === b.user_id)?.name).filter(Boolean);
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">${holders.length ? `${esc(role.name)} is still in use` : `Delete ${esc(role.name)}?`}</h3>
            ${holders.length
                ? `<p style="font-size:13px;color:#86868b;margin:0 0 12px;line-height:1.6">${holders.length} member${holders.length === 1 ? '' : 's'} hold this role: ${esc(holders.join(', '))}. Move them to another role first.</p>`
                : `<p style="font-size:13px;color:#86868b;margin:0 0 12px;line-height:1.6">Nobody holds this role, so deleting it changes no one's access.</p>`}
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrgDetail('${org.id}', 'roles')" class="btn-secondary">${holders.length ? 'Close' : 'Cancel'}</button>
                ${holders.length ? '' : `<button onclick="deleteRole('${org.id}', '${role.id}')" class="btn-primary" style="background:#dc2626"><i class="ph ph-trash"></i> Delete</button>`}
            </div>
        </div>`);
}

function deleteRole(orgId, roleId) {
    const org = getOrgById(orgId);
    const role = ROLES.find(r => r.id === roleId);
    if (!canSeeOrg(org) || !role || !canRemoveMembers()) return;
    if (ROLE_BINDINGS.some(b => b.role_id === roleId)) return;
    const ok = commitPortalMutation(() => {
        ROLES = ROLES.filter(r => r.id !== roleId);
        logActivity('Role deleted', org.name, role.name);
    });
    if (!ok) return;
    showOrgDetail(orgId, 'roles');
    renderOrganizations();
    showToast(`${role.name} deleted`);
}

// An individual customer has one account and one Owner role, both created
// with the organization. It is shown, not managed.
function orgAccountTab(org, members) {
    const holder = members[0];
    if (!holder) return `<div style="padding:20px 0">${emptyState('ph-user', 'No account is attached to this individual customer.', '')}</div>`;
    return `
        <div style="display:flex;align-items:center;gap:12px;border:1px solid var(--border-light);border-radius:12px;padding:12px 14px">
            <span style="width:34px;height:34px;border-radius:50%;background:#eef1ff;color:#1432E6;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">${esc(getUserInitials(holder.user.name))}</span>
            <span style="flex:1;min-width:0">
                <span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(holder.user.name)}${holder.user.status !== 'active' ? ' <span class="badge badge-zinc">Disabled</span>' : ''}</span>
                <span style="display:block;font-size:12px;color:#86868b">${esc(holder.user.email)}</span>
            </span>
            <span class="badge badge-zinc">${esc(ROLES.find(r => r.id === holder.bindings[0]?.role_id)?.name || '')}</span>
        </div>
        <div class="field-hint" style="margin-top:10px">An individual customer is one person, so there are no members or roles to manage. Disable the account from the Accounts page if they should lose access.</div>`;
}

// ── Members ──

function roleCheckboxes(org, checkedIds = []) {
    return getOrgRoles(org.id).map(r => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid var(--border-light);border-radius:10px;cursor:pointer">
            <input type="checkbox" class="member-role-check" value="${r.id}" ${checkedIds.includes(r.id) ? 'checked' : ''} style="margin-top:3px">
            <span><span style="display:block;font-size:13px;font-weight:600;color:#1d1d1f">${esc(r.name)}</span>
            ${r.description ? `<span style="display:block;font-size:12px;color:#86868b">${esc(r.description)}</span>` : ''}</span>
        </label>`).join('');
}
function checkedRoleIds() { return [...document.querySelectorAll('.member-role-check:checked')].map(el => el.value); }

function showAddMemberModal(orgId) {
    const org = getOrgById(orgId);
    if (!canSeeOrg(org) || !canAddMembers() || !orgAllowsMembers(org) || !getOrgRoles(orgId).length) return;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 4px">Add member</h3>
            <div style="font-size:13px;color:#86868b;margin-bottom:18px">${esc(org.name)}</div>
            <label class="field-label" for="member-email">Email <span class="req">*</span></label>
            <input id="member-email" class="input-field" type="email" maxlength="100" autocomplete="off" placeholder="name@company.com" oninput="onMemberEmailInput('${org.id}')">
            <div id="member-email-hint" class="field-hint"></div>
            <div id="member-name-wrap" style="margin-top:12px">
                <label class="field-label" for="member-name">Name <span class="req">*</span></label>
                <input id="member-name" class="input-field" maxlength="100" autocomplete="off" placeholder="Full name">
            </div>
            <div class="field-label" style="margin-top:14px">Roles <span class="req">*</span></div>
            <div style="display:grid;gap:8px">${roleCheckboxes(org)}</div>
            <p id="member-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin:14px 0 0"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrgDetail('${org.id}', 'members')" class="btn-secondary">Cancel</button>
                <button onclick="addMember('${org.id}')" class="btn-primary"><i class="ph ph-user-plus"></i> Add</button>
            </div>
        </div>`, 'md');
    document.getElementById('member-email')?.focus();
}

// An email already on file reuses that account — this is where one account
// comes to belong to several organizations. Only the desk sees whose account
// it is; a customer admin is not told who holds an email elsewhere.
function onMemberEmailInput(orgId) {
    const user = findUserByEmail(document.getElementById('member-email')?.value);
    const hint = document.getElementById('member-email-hint');
    const nameWrap = document.getElementById('member-name-wrap');
    if (nameWrap) nameWrap.style.display = user ? 'none' : '';
    if (!hint) return;
    if (!user) { hint.textContent = 'A new account is created with this email.'; return; }
    const already = getOrgBindings(orgId).some(b => b.user_id === user.id);
    hint.textContent = already
        ? 'This account is already a member here. Change its roles from the member list instead.'
        : isOperatorView()
            ? `Existing account: ${user.name}. It keeps its other roles and is added to this organization.`
            : 'This email already has an account. It will be added to this organization.';
}

function addMember(orgId) {
    const org = getOrgById(orgId);
    if (!canSeeOrg(org) || !canAddMembers() || !orgAllowsMembers(org)) return;
    const email = (document.getElementById('member-email')?.value || '').trim();
    const name = (document.getElementById('member-name')?.value || '').trim();
    const roleIds = checkedRoleIds();
    const err = document.getElementById('member-error');
    const fail = msg => { err.textContent = msg; err.style.display = 'block'; };
    const emailError = validateLoginEmail(email);
    if (emailError) return fail(emailError);
    const existing = findUserByEmail(email);
    if (existing && getOrgBindings(orgId).some(b => b.user_id === existing.id)) return fail('This account is already a member here. Change its roles from the member list instead.');
    if (!existing && !name) return fail('Name is required for a new account.');
    if (!roleIds.length) return fail('Pick at least one role.');
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        let user = existing;
        if (!user) {
            user = { id: `u-${Date.now()}`, name, email, status: 'active', is_super_admin: false, created_at: now, updated_at: now };
            USERS.push(user);
        }
        roleIds.forEach((roleId, i) => ROLE_BINDINGS.push({ id: `rb-${Date.now()}-${i}`, user_id: user.id, role_id: roleId, status: 'active', created_at: now }));
        logActivity('Member added', org.name, `${user.email} · ${roleIds.map(id => ROLES.find(r => r.id === id)?.name).join(', ')}${existing ? ' · existing account' : ' · new account'}`);
    });
    if (!ok) return;
    showOrgDetail(org.id, 'members');
    renderOrganizations();
    showToast(`${existing ? existing.name : name} added to ${org.name}`);
}

// The signed-in account may not drop the role it is acting under: that
// would pull the floor out from under the current session.
function wouldDropActiveBinding(userId, bindingIds) {
    return !viewAsBindingId && userId === currentUser?.id && bindingIds.includes(activeBindingId);
}

function showEditMemberModal(orgId, userId) {
    const org = getOrgById(orgId);
    const user = USERS.find(u => u.id === userId);
    if (!canSeeOrg(org) || !user || !canEditMembers()) return;
    const current = getOrgBindings(orgId).filter(b => b.user_id === userId).map(b => b.role_id);
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 4px">Roles for ${esc(user.name)}</h3>
            <div style="font-size:13px;color:#86868b;margin-bottom:16px">${esc(user.email)} · ${esc(org.name)}</div>
            <div style="display:grid;gap:8px">${roleCheckboxes(org, current)}</div>
            <div class="field-hint" style="margin-top:8px">Keep at least one role. To take the account out of this organization, remove the member instead.</div>
            <p id="member-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin:14px 0 0"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrgDetail('${org.id}', 'members')" class="btn-secondary">Cancel</button>
                <button onclick="saveMemberRoles('${org.id}', '${user.id}')" class="btn-primary"><i class="ph ph-check"></i> Save</button>
            </div>
        </div>`, 'md');
}

function saveMemberRoles(orgId, userId) {
    const org = getOrgById(orgId);
    const user = USERS.find(u => u.id === userId);
    if (!canSeeOrg(org) || !user || !canEditMembers()) return;
    const err = document.getElementById('member-error');
    const fail = msg => { err.textContent = msg; err.style.display = 'block'; };
    const wanted = checkedRoleIds();
    if (!wanted.length) return fail('Keep at least one role, or remove the member instead.');
    const held = getOrgBindings(orgId).filter(b => b.user_id === userId);
    const dropped = held.filter(b => !wanted.includes(b.role_id));
    const addedRoleIds = wanted.filter(id => !held.some(b => b.role_id === id));
    if (wouldDropActiveBinding(userId, dropped.map(b => b.id))) return fail('You are signed in under a role you are removing. Switch to another role first.');
    if (!dropped.length && !addedRoleIds.length) { showOrgDetail(org.id, 'members'); return; }
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        const droppedIds = new Set(dropped.map(b => b.id));
        ROLE_BINDINGS = ROLE_BINDINGS.filter(b => !droppedIds.has(b.id));
        addedRoleIds.forEach((roleId, i) => ROLE_BINDINGS.push({ id: `rb-${Date.now()}-${i}`, user_id: userId, role_id: roleId, status: 'active', created_at: now }));
        logActivity('Member roles changed', org.name, `${user.email} · ${wanted.map(id => ROLES.find(r => r.id === id)?.name).join(', ')}`);
    });
    if (!ok) return;
    if (userId === currentUser?.id) renderUserMenu();
    showOrgDetail(org.id, 'members');
    showToast(`Roles updated for ${user.name}`);
}

function confirmRemoveMember(orgId, userId) {
    const org = getOrgById(orgId);
    const user = USERS.find(u => u.id === userId);
    if (!canSeeOrg(org) || !user || !canRemoveMembers()) return;
    const here = getOrgBindings(orgId).filter(b => b.user_id === userId);
    if (wouldDropActiveBinding(userId, here.map(b => b.id))) {
        showToast('You are signed in under a role in this organization. Switch to another role first.', 'error');
        return;
    }
    const remaining = ROLE_BINDINGS.filter(b => b.user_id === userId).length - here.length;
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 8px">Remove ${esc(user.name)} from ${esc(org.name)}?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 12px;line-height:1.6">Removes ${here.length === 1 ? 'the role' : `all ${here.length} roles`} ${esc(here.map(b => ROLES.find(r => r.id === b.role_id)?.name).join(', '))} in this organization. The account itself is kept.</p>
            ${remaining ? '' : `<div style="font-size:12.5px;color:#9a3412;background:#fff7ed;border-radius:10px;padding:10px 12px">This account holds no other role, so it will no longer be able to sign in.</div>`}
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showOrgDetail('${org.id}', 'members')" class="btn-secondary">Cancel</button>
                <button onclick="removeMember('${org.id}', '${user.id}')" class="btn-primary" style="background:#dc2626"><i class="ph ph-user-minus"></i> Remove</button>
            </div>
        </div>`);
}

function removeMember(orgId, userId) {
    const org = getOrgById(orgId);
    const user = USERS.find(u => u.id === userId);
    if (!canSeeOrg(org) || !user || !canRemoveMembers()) return;
    const ids = new Set(getOrgBindings(orgId).filter(b => b.user_id === userId).map(b => b.id));
    if (wouldDropActiveBinding(userId, [...ids])) return;
    const ok = commitPortalMutation(() => {
        ROLE_BINDINGS = ROLE_BINDINGS.filter(b => !ids.has(b.id));
        logActivity('Member removed', org.name, user.email);
    });
    if (!ok) return;
    showOrgDetail(org.id, 'members');
    renderOrganizations();
    showToast(`${user.name} removed from ${org.name}`);
}

// ═══════════════════════════════════════════════════════════════════
// VIEW AS — bottom-right switch, Super Admin only. Views the workspace as
// any member of an enabled org: their role's grants and org scope apply
// through the same hasPermission() as a real account, and person-level state
// (notifications) is theirs. No data is changed.
// ═══════════════════════════════════════════════════════════════════

let viewAsMenuOpen = false;

// Members a demo can view as, grouped by org, for orgs whose type is enabled.
// One entry per active role binding, so a person holding two roles appears
// under each org they act in.
function viewAsMemberGroups() {
    return ORGS
        .filter(org => org.status === 'active' && org.types.some(t => ENABLED_ORG_TYPES.includes(t)))
        .map(org => {
            const roleIds = new Set(ROLES.filter(r => r.org_id === org.id).map(r => r.id));
            const members = ROLE_BINDINGS
                .filter(b => b.status === 'active' && roleIds.has(b.role_id))
                .map(b => ({ binding: b, user: USERS.find(u => u.id === b.user_id), role: ROLES.find(r => r.id === b.role_id) }))
                .filter(m => m.user && m.user.status === 'active')
                .sort((x, y) => x.user.name.localeCompare(y.user.name) || x.role.name.localeCompare(y.role.name));
            return { org, members };
        })
        .filter(g => g.members.length);
}

function toggleViewAsMenu(e) {
    if (e) e.stopPropagation();
    viewAsMenuOpen = !viewAsMenuOpen;
    renderViewAsSwitch();
}

function closeViewAsMenu() {
    if (!viewAsMenuOpen) return;
    viewAsMenuOpen = false;
    renderViewAsSwitch();
}

document.addEventListener('click', e => {
    if (!e.target.closest('#view-as-root')) closeViewAsMenu();
});

function setViewAs(bindingId = null) {
    if (!currentUser?.is_super_admin) return;
    viewAsMenuOpen = false;
    closeModal();
    viewAsBindingId = bindingId && ROLE_BINDINGS.some(b => b.id === bindingId) ? bindingId : null;
    renderSidebarUser();
    buildNav();
    renderViewAsSwitch();
    // Stay on the current view when it survives the switch; otherwise land
    // on the first one the new perspective can see.
    const allowed = visibleNavItems().map(n => n.key);
    navigate(allowed.includes(currentView) ? currentView : allowed[0]);
    const role = activeRole();
    showToast(role ? `Viewing as ${actingName()} · ${activeOrg()?.name} ${role.name}` : 'Back to Super Admin view', 'info');
}

function renderViewAsSwitch() {
    const root = document.getElementById('view-as-root');
    if (!root) return;
    if (!currentUser?.is_super_admin) { root.innerHTML = ''; return; }
    const groups = viewAsMemberGroups();
    const role = activeRole();
    const item = (id, icon, label, sub, active) => `
                <button class="view-as-item ${active ? 'active' : ''}" onclick="setViewAs(${id ? `'${id}'` : 'null'})">
                    <i class="ph ${icon}" style="font-size:16px"></i>
                    <span style="flex:1;min-width:0">${esc(label)}${sub ? `<span style="display:block;font-size:11px;font-weight:400;color:#86868b">${esc(sub)}</span>` : ''}</span>
                    ${active ? '<i class="ph ph-check"></i>' : ''}
                </button>`;
    root.innerHTML = `
        <div class="view-as">
            ${viewAsMenuOpen ? `
            <div class="view-as-menu" style="max-height:60vh;overflow-y:auto">
                <div class="view-as-label">View as</div>
                ${item(null, 'ph-shield-check', 'Super Admin', '', !viewAsBindingId)}
                ${groups.length ? groups.map(g => `
                <div class="view-as-label">${esc(g.org.name)}</div>
                ${g.members.map(m => item(m.binding.id, orgHasType(g.org, 'OPERATOR') ? 'ph-shield' : 'ph-user', m.user.name, m.role.name, viewAsBindingId === m.binding.id)).join('')}`).join('')
                : '<div style="font-size:12px;color:#86868b;padding:6px 10px">No members yet. Add people under Organizations.</div>'}
                <div style="font-size:11px;color:#86868b;padding:8px 10px 4px;border-top:1px solid var(--border-light);margin-top:4px">Acts as that person under that role: their permissions, organization and notifications. Roles with no members are not listed. No data is changed.</div>
            </div>` : ''}
            <button class="view-as-btn ${isCustomerView() ? 'customer' : ''}" onclick="toggleViewAsMenu(event)" title="Switch perspective">
                <i class="ph ${viewAsBindingId ? 'ph-user' : 'ph-eye'}" style="font-size:15px"></i>
                <span>${role ? `Viewing as ${esc(actingName())} · ${esc(activeOrg()?.name || '')} ${esc(role.name)}` : 'Viewing as Super Admin'}</span>
                <i class="ph ${viewAsMenuOpen ? 'ph-caret-down' : 'ph-caret-up'}" style="font-size:12px;opacity:.7"></i>
            </button>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE DESK — after-sales tickets anchored to order lines
// ═══════════════════════════════════════════════════════════════════

function getTicketById(id) { return TICKETS.find(t => t.id === id) || null; }
function getTicketMessages(ticketId) {
    return TICKET_MESSAGES.filter(m => m.ticket_id === ticketId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
function getLineTickets(lineId) { return TICKETS.filter(t => t.order_line_id === lineId); }
function getOrderTickets(orderId) { return TICKETS.filter(t => t.order_id === orderId); }

function nextTicketNo() {
    const max = TICKETS.reduce((m, t) => Math.max(m, parseInt((t.ticket_no || '').replace(/\D/g, ''), 10) || 0), 0);
    return `TK-${String(max + 1).padStart(4, '0')}`;
}

const TICKET_STATUS_LABEL = {
    OPEN: 'Open', IN_PROGRESS: 'In progress', AWAITING_CUSTOMER_INFO: 'Awaiting customer',
    RESOLVED: 'Resolved', CLOSED: 'Closed',
};
const TICKET_STATUS_BADGE = {
    OPEN: 'badge-blue', IN_PROGRESS: 'badge-orange', AWAITING_CUSTOMER_INFO: 'badge-amber',
    RESOLVED: 'badge-green', CLOSED: 'badge-zinc',
};
const TICKET_PRIORITY_BADGE = { HIGH: 'badge-red', MEDIUM: 'badge-amber', LOW: 'badge-zinc' };
const TICKET_ACTIVE_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER_INFO'];

function ticketStatusBadge(s) {
    return `<span class="badge ${TICKET_STATUS_BADGE[s] || 'badge-zinc'}">${esc(TICKET_STATUS_LABEL[s] || s)}</span>`;
}
function ticketPriorityBadge(p) {
    const label = p ? p[0] + p.slice(1).toLowerCase() : '—';
    return `<span class="badge ${TICKET_PRIORITY_BADGE[p] || 'badge-zinc'}">${esc(label)}</span>`;
}

function ticketTimeAgo(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.max(0, Math.round(diffMs / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}
function ticketDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${toIsoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// First response: hours from creation until AISO's first customer-visible reply.
// ── Internal handling state (desk-only) ──
// The public status tells the customer where their request stands; this says
// who the desk is waiting on. Old saves predate the field, hence the default.
function ticketInternalState(t) {
    const state = t?.internal_state || 'NONE';
    return TICKET_INTERNAL_STATES.includes(state) ? state : 'NONE';
}
function isTicketReferred(t) { return ticketInternalState(t) !== 'NONE'; }

// Who a referral goes to, read from the live order and falling back to the
// snapshot taken when the ticket was opened.
function ticketInternalParty(t, state) {
    const order = getOrderById(t.order_id);
    if (state === 'HW_SUPPLIER') return (order?.hw_supplier_name || (t.scope === 'HW' ? t.snapshot?.supplier_name : '') || '').trim();
    if (state === 'SW_SUPPLIER') {
        const line = t.scope === 'SW' ? ORDER_LINES.find(l => l.id === t.order_line_id) : null;
        return (line?.supplier_name || order?.sw_supplier_name || (t.scope === 'SW' ? t.snapshot?.supplier_name : '') || '').trim();
    }
    if (state === 'SI') return (order?.si_name || t.snapshot?.si_name || '').trim();
    if (state === 'AISO_INTERNAL') return 'AISO';
    return '';
}

function ticketInternalChip(t, { compact = false } = {}) {
    if (!isTicketReferred(t)) return '';
    const state = ticketInternalState(t);
    const days = t.internal_since ? Math.floor((Date.now() - new Date(t.internal_since)) / 86400000) : null;
    const label = compact ? (t.internal_party || TICKET_INTERNAL_STATE_LABEL[state])
        : `${TICKET_INTERNAL_STATE_LABEL[state]}${state === 'AISO_INTERNAL' && t.internal_assignee_id ? ` · ${t.internal_party}` : ''}`;
    const age = days === null ? '' : ` · ${days}d`;
    // A colleague sitting on a confirmation for a day or more is the stale case.
    const stale = state === 'AISO_INTERNAL' && days >= 1;
    return `<span class="badge ${stale ? 'badge-red' : 'badge-orange'}" title="Internal: ${esc(TICKET_INTERNAL_STATE_LABEL[state])}${t.internal_party ? ` — ${esc(t.internal_party)}` : ''}. The customer does not see this."><i class="ph ph-arrow-bend-up-right"></i> ${esc(label)}${esc(age)}</span>`;
}

function setTicketInternalState(ticketId, state, { assigneeId = null, note = '' } = {}) {
    const t = getTicketById(ticketId);
    if (!t || !canManageTickets() || !TICKET_INTERNAL_STATES.includes(state) || ticketInternalState(t) === state) return;
    // Internal work goes to a named colleague when there is one to name.
    if (state === 'AISO_INTERNAL' && !assigneeId && deskStaff().some(u => u.id !== actingUser()?.id)) {
        showReferInternalModal(t.id);
        return;
    }
    const party = state === 'AISO_INTERNAL' && assigneeId ? userNameById(assigneeId) : ticketInternalParty(t, state);
    // Referring to a party the order never named would leave an empty chip.
    if (state !== 'NONE' && state !== 'AISO_INTERNAL' && !party) {
        showToast(`${t.snapshot?.order_no || 'This order'} records no ${state === 'SI' ? 'system integrator' : state === 'HW_SUPPLIER' ? 'HW supplier' : 'SW supplier'}.`, 'error');
        showTicketDetail(t.id);
        return;
    }
    const now = new Date().toISOString();
    const from = ticketInternalState(t);
    const ok = commitPortalMutation(() => {
        t.internal_state = state;
        t.internal_party = state === 'NONE' ? '' : party;
        t.internal_since = state === 'NONE' ? null : now;
        t.internal_assignee_id = state === 'AISO_INTERNAL' ? (assigneeId || null) : null;
        t.internal_referred_by = state === 'AISO_INTERNAL' && assigneeId ? (actingUser()?.id || null) : null;
        t.updated_at = now;
        // The thread is the audit trail, and an internal note never reaches
        // the customer — so the referral is recorded there too.
        const msgId = `tm-${Date.now()}`;
        TICKET_MESSAGES.push({
            id: msgId, ticket_id: t.id, author_type: 'INTERNAL', author_name: actingName(),
            is_internal: true, created_at: now,
            body: state === 'NONE'
                ? `Back with the desk (was ${TICKET_INTERNAL_STATE_LABEL[from]}).`
                : state === 'AISO_INTERNAL' && assigneeId
                    ? `Referred to ${party} for confirmation.${note ? ` ${note}` : ''}`
                    : `Referred to ${party} — ${TICKET_INTERNAL_STATE_LABEL[state]}.`,
            attachments: [],
            notify_user_ids: t.internal_assignee_id ? [t.internal_assignee_id] : [],
        });
        if (t.internal_assignee_id) notifyUsers([t.internal_assignee_id], t, 'CONFIRM', msgId);
        logActivity('Ticket handling changed', t.ticket_no, `${TICKET_INTERNAL_STATE_LABEL[from]} → ${TICKET_INTERNAL_STATE_LABEL[state]}${party ? ` (${party})` : ''}`);
    });
    if (!ok) return;
    renderServiceDesk();
    showTicketDetail(t.id);
    showToast(state === 'NONE' ? `${t.ticket_no} back with the desk` : `${t.ticket_no} referred to ${party}`);
}

function ticketFirstResponse(t) {
    const targetHours = TICKET_FIRST_RESPONSE_HOURS[t.snapshot?.sla_plan] || TICKET_FIRST_RESPONSE_DEFAULT_HOURS;
    const end = t.first_response_at ? new Date(t.first_response_at) : new Date();
    const elapsedHours = Math.max(0, (end - new Date(t.created_at)) / 3600000);
    const answered = !!t.first_response_at;
    const overdue = !answered && TICKET_ACTIVE_STATUSES.includes(t.status) && elapsedHours > targetHours;
    return { targetHours, elapsedHours, answered, overdue, ratio: Math.min(1, elapsedHours / targetHours) };
}

// Coverage from the snapshot: warranty for HW, license for SW.
function ticketCoverage(snap) {
    if (!snap?.coverage_end) return { known: false };
    const days = Math.round((new Date(snap.coverage_end) - new Date(todayIso())) / 86400000);
    return { known: true, days, active: days >= 0, end: snap.coverage_end, kind: snap.coverage_kind === 'license' ? 'License' : 'Warranty' };
}

// ── Internal notifications (docs/SERVICE_DESK_PLAN.md, 內部通知) ──
// In-app only, for AISO people. Created when an internal note names a
// colleague, when a ticket is referred to someone for confirmation, and when
// that confirmation comes back. Naming someone notifies them; it does not
// hide the note from the rest of the desk.

let notifMenuOpen = false;

// Colleagues who can work tickets: active members of an operator org whose
// role can update tickets.
function deskStaff() {
    const roleIds = new Set(ROLES
        .filter(r => orgHasType(getOrgById(r.org_id), 'OPERATOR') && r.permissions.includes(PORTAL_PERMISSIONS.TICKET_UPDATE))
        .map(r => r.id));
    const userIds = new Set(ROLE_BINDINGS.filter(b => b.status === 'active' && roleIds.has(b.role_id)).map(b => b.user_id));
    return USERS.filter(u => userIds.has(u.id) && u.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
}
function userNameById(id) { return USERS.find(u => u.id === id)?.name || ''; }

// Call inside a commitPortalMutation. Nobody is notified of their own action.
function notifyUsers(userIds, ticket, kind, messageId = null) {
    const me = actingUser()?.id;
    const now = new Date().toISOString();
    [...new Set(userIds)].filter(id => id && id !== me).forEach((id, i) => NOTIFICATIONS.unshift({
        id: `nt-${Date.now()}-${i}`, user_id: id, ticket_id: ticket.id, message_id: messageId, kind,
        actor_name: actingName(), created_at: now, read_at: null,
    }));
}

function myNotifications() {
    const me = actingUser();
    return me && isOperatorView() ? NOTIFICATIONS.filter(n => n.user_id === me.id) : [];
}

// A ticket needs me while it waits on my confirmation, or while I have an
// unread notification on it.
function ticketNeedsMe(t) {
    const me = actingUser();
    if (!me || !isOperatorView()) return false;
    return isWaitingOnMe(t) || NOTIFICATIONS.some(n => n.user_id === me.id && n.ticket_id === t.id && !n.read_at);
}
function isWaitingOnMe(t) {
    const me = actingUser();
    return !!me && ticketInternalState(t) === 'AISO_INTERNAL' && t.internal_assignee_id === me.id;
}

// Opening a ticket reads my notifications on it. A confirmation request stays
// on the Needs me list until it is confirmed, whatever its read state.
function markTicketNotificationsRead(ticketId) {
    const unread = myNotifications().filter(n => n.ticket_id === ticketId && !n.read_at);
    if (!unread.length) return;
    const now = new Date().toISOString();
    unread.forEach(n => { n.read_at = now; });
    Store.save({ notify: false });
    renderNotificationBell();
}

function notificationText(n) {
    const t = getTicketById(n.ticket_id);
    const no = t?.ticket_no || 'a ticket';
    if (n.kind === 'CONFIRM') return `${n.actor_name} needs your confirmation on ${no}`;
    if (n.kind === 'CONFIRMED') return `${n.actor_name} confirmed ${no}`;
    return `${n.actor_name} flagged you in an internal note on ${no}`;
}

function renderNotificationBell() {
    const root = document.getElementById('notif-root');
    if (!root) return;
    const me = actingUser();
    if (!me || !isOperatorView()) { root.innerHTML = ''; notifMenuOpen = false; return; }
    const list = myNotifications();
    const unread = list.filter(n => !n.read_at).length;
    root.innerHTML = `
        <button class="notif-btn" onclick="toggleNotifMenu(event)" aria-label="Notifications${unread ? `, ${unread} unread` : ''}" title="Notifications">
            <i class="ph ph-bell"></i>${unread ? `<span class="notif-count">${unread > 99 ? '99+' : unread}</span>` : ''}
        </button>
        ${notifMenuOpen ? `
        <div class="notif-menu" onclick="event.stopPropagation()">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px 8px">
                <span style="font-size:12.5px;font-weight:700">Notifications</span>
                ${unread ? '<button class="btn-link" style="font-size:12px" onclick="markAllNotificationsRead()">Mark all read</button>' : ''}
            </div>
            ${list.length ? list.slice(0, 30).map(n => {
                const t = getTicketById(n.ticket_id);
                return `<button class="notif-item ${n.read_at ? '' : 'unread'}" onclick="openNotification('${n.id}')">
                    <span class="dot"></span>
                    <span style="min-width:0;flex:1"><span class="txt">${esc(notificationText(n))}</span>
                        <span style="display:block;color:#86868b;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t?.subject || '')} · ${ticketTimeAgo(n.created_at)}</span></span>
                </button>`;
            }).join('') : '<div style="font-size:12.5px;color:#86868b;padding:14px 10px;text-align:center">Nothing yet. Colleagues can flag you in internal notes.</div>'}
        </div>` : ''}`;
}

function toggleNotifMenu(e) {
    if (e) e.stopPropagation();
    notifMenuOpen = !notifMenuOpen;
    renderNotificationBell();
}

document.addEventListener('click', e => {
    if (notifMenuOpen && !e.target.closest('#notif-root')) { notifMenuOpen = false; renderNotificationBell(); }
});

function openNotification(id) {
    const n = NOTIFICATIONS.find(x => x.id === id);
    notifMenuOpen = false;
    if (!n) return;
    if (currentView !== 'service-desk') navigate('service-desk');
    showTicketDetail(n.ticket_id); // marks it read
    renderServiceDesk();
}

function markAllNotificationsRead() {
    const now = new Date().toISOString();
    myNotifications().filter(n => !n.read_at).forEach(n => { n.read_at = now; });
    Store.save({ notify: false });
    renderNotificationBell();
    if (currentView === 'service-desk') renderServiceDesk();
}

// Picking "AISO internal work" asks who has to confirm before referring.
function showReferInternalModal(ticketId) {
    const t = getTicketById(ticketId);
    const staff = deskStaff().filter(u => u.id !== actingUser()?.id);
    showModal(`
        <div style="padding:26px 28px">
            <h3 style="font-size:1.05rem;font-weight:700;margin:0 0 6px">Who needs to confirm ${esc(t.ticket_no)}?</h3>
            <p style="font-size:13px;color:#86868b;margin:0 0 16px;line-height:1.6">They get a notification and the ticket stays on their Needs me list until they mark it confirmed. The customer does not see this.</p>
            <label class="field-label" for="refer-assignee">Confirm by</label>
            <select id="refer-assignee" class="input-field">
                ${staff.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
            </select>
            <label class="field-label" for="refer-note" style="margin-top:12px">What to confirm</label>
            <textarea id="refer-note" class="input-field" style="min-height:72px" placeholder="Optional. Goes into the internal note."></textarea>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button onclick="showTicketDetail('${t.id}')" class="btn-secondary text-xs">Cancel</button>
                <button onclick="setTicketInternalState('${t.id}', 'AISO_INTERNAL', { assigneeId: document.getElementById('refer-assignee').value, note: document.getElementById('refer-note').value.trim() })" class="btn-primary text-xs"><i class="ph ph-arrow-bend-up-right"></i> Refer</button>
            </div>
        </div>`, 'md');
}

function confirmTicketInternal(ticketId) {
    const t = getTicketById(ticketId);
    if (!t || !isWaitingOnMe(t)) return;
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        const msgId = `tm-${Date.now()}`;
        TICKET_MESSAGES.push({
            id: msgId, ticket_id: t.id, author_type: 'INTERNAL', author_name: actingName(),
            is_internal: true, created_at: now, body: `Confirmed by ${actingName()}. Back with the desk.`, attachments: [],
            notify_user_ids: t.internal_referred_by ? [t.internal_referred_by] : [],
        });
        notifyUsers([t.internal_referred_by], t, 'CONFIRMED', msgId);
        Object.assign(t, { internal_state: 'NONE', internal_party: '', internal_since: null, internal_assignee_id: null, internal_referred_by: null, updated_at: now });
        logActivity('Ticket handling changed', t.ticket_no, `Confirmed by ${actingName()}`);
    });
    if (!ok) return;
    renderServiceDesk();
    showTicketDetail(t.id);
    showToast(`${t.ticket_no} confirmed`);
}

function toggleReplyNotify(userId) {
    const list = ticketReplyDraft.notify || (ticketReplyDraft.notify = []);
    const i = list.indexOf(userId);
    if (i >= 0) list.splice(i, 1); else list.push(userId);
    const text = document.getElementById('tk-reply')?.value;
    if (text !== undefined) ticketReplyDraft.text = text;
    showTicketDetail(ticketReplyDraft.ticketId);
}

// ── Page action / list ──

function serviceDeskPageAction() {
    const newBtn = canCreateTickets() ? `<button onclick="showTicketCreateModal()" class="btn-primary"><i class="ph ph-plus"></i> New Ticket</button>` : '';
    if (isCustomerView()) return `<div style="white-space:nowrap">${newBtn}</div>`;
    const names = [...new Set(TICKETS.map(t => t.customer_name).concat(ORDERS.filter(o => o.status === 'CONFIRMED').map(o => o.customer_name)))].filter(Boolean).sort();
    const current = document.getElementById('ticket-customer')?.value || '';
    const handling = document.getElementById('ticket-handling')?.value || '';
    return `<div style="display:flex;align-items:center;gap:10px;white-space:nowrap">
        <select id="ticket-customer" class="select-field" onchange="renderServiceDesk()">
            <option value="">All customers</option>
            ${names.map(n => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <select id="ticket-handling" class="select-field" onchange="renderServiceDesk()" title="Who the desk is waiting on">
            <option value="">All handling</option>
            <option value="REFERRED" ${handling === 'REFERRED' ? 'selected' : ''}>Referred (any)</option>
            ${TICKET_INTERNAL_STATES.map(st => `<option value="${st}" ${st === handling ? 'selected' : ''}>${TICKET_INTERNAL_STATE_LABEL[st]}</option>`).join('')}
        </select>
        ${newBtn}
    </div>`;
}

function setTicketFilter(val) {
    document.getElementById('ticket-filter-status').value = val;
    document.querySelectorAll('#ticket-filter-tabs .filter-tab').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    renderServiceDesk();
}

function ticketCustomerScope() {
    return isCustomerView() ? '' : (document.getElementById('ticket-customer')?.value || '');
}

// A customer sees its own org's tickets; the desk can narrow by customer name.
function getScopedTickets() {
    if (isCustomerView()) return TICKETS.filter(t => t.customer_org_id === activeOrgId());
    const customer = ticketCustomerScope();
    return TICKETS.filter(t => !customer || t.customer_name === customer);
}

function getFilteredTickets() {
    const status = document.getElementById('ticket-filter-status')?.value || '';
    const q = (document.getElementById('ticket-search')?.value || '').trim().toLowerCase();
    const handling = isOperatorView() ? (document.getElementById('ticket-handling')?.value || '') : '';
    return getScopedTickets().filter(t => {
        if (status === 'NEEDS_ME') { if (!ticketNeedsMe(t)) return false; }
        else if (status && t.status !== status) return false;
        if (handling === 'REFERRED' && !isTicketReferred(t)) return false;
        if (handling && handling !== 'REFERRED' && ticketInternalState(t) !== handling) return false;
        if (q && ![t.ticket_no, t.subject, t.customer_name, t.snapshot?.order_no, t.snapshot?.product_name, t.serial_no]
            .some(v => (v || '').toLowerCase().includes(q))) return false;
        return true;
    }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

function renderTicketStats() {
    const target = document.getElementById('tk-stats-bar');
    if (!target) return;
    const all = getScopedTickets();
    const month = todayIso().slice(0, 7);
    const open = all.filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;
    const awaiting = all.filter(t => t.status === 'AWAITING_CUSTOMER_INFO').length;
    const overdue = all.filter(t => ticketFirstResponse(t).overdue).length;
    const resolved = all.filter(t => (t.resolved_at || '').slice(0, 7) === month).length;
    const stat = (v, l, color = '#1d1d1f') => `<div class="tk-stat"><div class="v" style="color:${color}">${v}</div><div class="l">${l}</div></div>`;
    target.innerHTML = stat(open, 'Open') + stat(awaiting, 'Awaiting customer', awaiting ? '#b45309' : '#1d1d1f')
        + stat(overdue, 'First response overdue', overdue ? '#dc2626' : '#1d1d1f') + stat(resolved, 'Resolved this month');
}

function renderServiceDesk() {
    // Needs me is a person's list: shown only while someone at AISO is acting.
    const needsTab = document.getElementById('ticket-needs-me-tab');
    if (needsTab) {
        const show = !!actingUser() && isOperatorView();
        needsTab.style.display = show ? '' : 'none';
        if (show) needsTab.innerHTML = `Needs me${(() => { const n = getScopedTickets().filter(ticketNeedsMe).length; return n ? ` <span class="badge badge-red" style="margin-left:4px;padding:1px 6px">${n}</span>` : ''; })()}`;
        if (!show && document.getElementById('ticket-filter-status')?.value === 'NEEDS_ME') setTicketFilter('');
    }
    renderNotificationBell();
    renderTicketStats();
    const list = getFilteredTickets();
    const searching = !!(document.getElementById('ticket-search')?.value || '').trim();
    const tbody = document.getElementById('tickets-tbody');
    if (!tbody) return;
    tbody.innerHTML = list.length ? list.map(t => {
        const fr = ticketFirstResponse(t);
        return `
        <tr class="cursor-pointer" onclick="if(!event.target.closest('button'))showTicketDetail('${t.id}')">
            <td>${ticketNeedsMe(t) ? `<span class="tk-needs-dot" title="${isWaitingOnMe(t) ? 'Waiting for your confirmation' : 'You were flagged on this ticket'}"></span>` : ''}<span style="font-weight:600;font-size:13px;color:#1d1d1f">${esc(t.ticket_no)}</span>
                <div style="font-size:11px;color:#86868b;margin-top:1px">${ticketTimeAgo(t.updated_at)}</div></td>
            <td><span style="font-size:13px;color:#1d1d1f">${esc(t.subject)}</span>
                <div style="font-size:11.5px;color:#86868b;margin-top:1px">${esc(t.category)} · via ${esc(t.channel || '—')}</div></td>
            <td><span style="font-size:13px;color:#1d1d1f">${esc(t.customer_name)}</span></td>
            <td><span style="font-size:13px;font-weight:600;color:#1d1d1f">${esc(t.snapshot?.order_no || '—')}</span>
                <div style="font-size:11.5px;color:#86868b;margin-top:1px">${esc(t.scope)} · ${esc(t.snapshot?.product_name || '')}${t.serial_no ? ` · <span style="font-family:ui-monospace,Menlo,monospace;white-space:nowrap">${esc(t.serial_no)}</span>` : ''}</div></td>
            <td style="white-space:nowrap">${ticketPriorityBadge(t.priority)}</td>
            <td style="white-space:nowrap">${ticketStatusBadge(t.status)}${fr.overdue ? ' <span class="badge badge-red" style="margin-left:4px" title="No AISO reply within the first-response target">Overdue</span>' : ''}
                ${isOperatorView() && isTicketReferred(t) ? `<div style="margin-top:4px">${ticketInternalChip(t, { compact: true })}</div>` : ''}</td>
            <td class="text-right" onclick="event.stopPropagation()">
                <button onclick="showTicketDetail('${t.id}')" class="btn-ghost" title="Details"><i class="ph ph-info"></i></button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-center py-16">${emptyState(
        'ph-headset',
        searching ? EMPTY_STATE_NO_RESULTS : EMPTY_STATE_NO_DATA,
        !searching && canCreateTickets() ? '<div class="flex items-center gap-2 justify-center mt-1"><button onclick="showTicketCreateModal()" class="btn-primary text-xs"><i class="ph ph-plus"></i> New Ticket</button></div>' : ''
    )}</td></tr>`;
}

// Jump from an order to its tickets.
function openServiceDeskForOrder(orderId) {
    const o = getOrderById(orderId);
    navigate('service-desk');
    const sel = document.getElementById('ticket-customer');
    if (sel && o && !isCustomerView()) sel.value = o.customer_name;
    const search = document.getElementById('ticket-search');
    if (search && o) search.value = o.order_no;
    renderServiceDesk();
}

// ── Entitlement card (shared by create + detail) ──

function ticketEntitlementCard(snap, serialNo) {
    const cov = ticketCoverage(snap);
    const ok = cov.known && cov.active;
    const headline = !cov.known ? 'Coverage not recorded on the order line'
        : `${cov.kind} ${ok ? 'active' : 'expired'} · ${ok ? `${cov.days} days left` : `${Math.abs(cov.days)} days ago`}`;
    return `<div class="tk-ent ${ok ? '' : 'exp'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:12.5px;font-weight:700;color:${ok ? '#047857' : '#b91c1c'}"><span class="tk-dot" style="background:${ok ? '#10b981' : '#ef4444'}"></span>${esc(headline)}</div>
            ${snap.sla_plan ? `<span class="badge badge-blue">SLA ${esc(snap.sla_plan)}</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-top:8px;font-size:12.5px">
            <div><span style="color:#86868b">${snap.coverage_kind === 'license' ? 'License key' : 'Serial'}</span><div style="margin-top:2px"><span class="tk-mono">${esc(serialNo || snap.license_key || '—')}</span></div></div>
            <div><span style="color:#86868b">Expires</span><div style="margin-top:2px;font-weight:600">${esc(snap.coverage_end || '—')}</div></div>
            <div><span style="color:#86868b">Supplier</span><div style="margin-top:2px;font-weight:600">${esc(snap.supplier_name || '—')}</div></div>
            <div><span style="color:#86868b">System integrator</span><div style="margin-top:2px;font-weight:600">${esc(snap.si_name || '—')}</div></div>
        </div>
        ${(snap.licenses || []).length ? `
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);font-size:12.5px">
            <span style="color:#86868b">Licenses on this unit</span>
            ${snap.licenses.map(lc => `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
                <span style="font-weight:600">${esc(lc.product_name)}</span><span class="tk-mono">${esc(lc.license_key)}</span>
                <span style="color:#86868b">${lc.all_units ? 'all units · ' : ''}to ${esc(lc.license_end || '—')}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

// Licenses bundled with a hardware unit: keys bound to that unit plus keys
// bound to all units of the line.
function unitLicenses(hwLine, serialNo) {
    const unit = (hwLine.serial_nos || []).indexOf(serialNo);
    if (unit < 0) return [];
    return ORDER_LINES.filter(l => l.parent_line_id === hwLine.id).flatMap(l => (l.license_keys || [])
        .filter(lk => lk.key && (lk.unit === null || lk.unit === unit))
        .map(lk => ({
            product_name: l.product_name + (l.version ? ` v${l.version}` : ''),
            license_key: lk.key, all_units: lk.unit === null, license_end: l.license_end || '',
        })));
}

// Build the snapshot a ticket keeps from the order + line (+ serial) it points at.
function buildTicketSnapshot(order, line, serialNo = '') {
    const isSw = line.scope === 'SW';
    return {
        order_no: order.order_no,
        line_no: line.line_no,
        product_name: line.product_name + (isSw && line.version ? ` v${line.version}` : ''),
        sla_plan: line.sla_plan || '',
        coverage_kind: isSw ? 'license' : 'warranty',
        coverage_end: isSw ? (line.license_end || '') : (line.warranty_end || ''),
        supplier_name: isSw ? (line.supplier_name || order.sw_supplier_name || '') : (order.hw_supplier_name || ''),
        si_name: order.si_name || '',
        license_key: isSw ? (line.license_keys || []).find(k => k.key)?.key || '' : '',
        licenses: !isSw && serialNo ? unitLicenses(line, serialNo) : [],
    };
}

// ── Create ──
// The modal edits `ticketDraft`; nothing touches TICKETS until save.

let ticketDraft = null;

function showTicketCreateModal({ lineId = null } = {}) {
    if (!canCreateTickets()) {
        showToast('You do not have permission to open tickets.', 'error');
        return;
    }
    ticketDraft = {
        customer_name: isCustomerView() ? (activeOrg()?.name || '') : (document.getElementById('ticket-customer')?.value || ''),
        order_id: '', order_line_id: '', serial_no: '',
        channel: isCustomerView() ? 'Workspace' : 'Email',
        priority: 'MEDIUM', category: TICKET_CATEGORIES[0],
        subject: '', description: '',
        reported_by: isCustomerView() ? actingName() : '',
        attachments: [],
    };
    if (lineId) {
        const line = ORDER_LINES.find(l => l.id === lineId);
        const order = line ? getOrderById(line.order_id) : null;
        if (line && order) {
            ticketDraft.customer_name = order.customer_name;
            ticketDraft.order_id = order.id;
            ticketDraft.order_line_id = line.id;
            const serials = (line.serial_nos || []).filter(s => s.trim());
            if (serials.length === 1) ticketDraft.serial_no = serials[0];
        }
    }
    renderTicketCreateModal();
}

function tkSet(key, value) {
    ticketDraft[key] = value;
    if (key === 'customer_name') { ticketDraft.order_id = ''; ticketDraft.order_line_id = ''; ticketDraft.serial_no = ''; }
    if (key === 'order_id') { ticketDraft.order_line_id = ''; ticketDraft.serial_no = ''; }
    if (key === 'order_line_id') {
        const line = ORDER_LINES.find(l => l.id === value);
        const serials = (line?.serial_nos || []).filter(s => s.trim());
        ticketDraft.serial_no = serials.length === 1 ? serials[0] : '';
    }
    renderTicketCreateModal();
}

function tkSetText(key, value) { ticketDraft[key] = value; }

function ticketDraftReady() {
    const d = ticketDraft;
    const line = ORDER_LINES.find(l => l.id === d.order_line_id);
    if (!line) return false;
    if (line.scope === 'HW' && (line.serial_nos || []).some(s => s.trim()) && !d.serial_no) return false;
    return true;
}

function renderTicketCreateModal() {
    const d = ticketDraft;
    const customers = isCustomerView() ? [activeOrg()?.name || '']
        : [...new Set(ORDERS.filter(o => o.status === 'CONFIRMED').map(o => o.customer_name))].filter(Boolean).sort();
    // A customer picks from its org's orders, whatever name each was typed under.
    const orders = ORDERS.filter(o => (isCustomerView() ? o.customer_org_id === activeOrgId() : o.customer_name === d.customer_name) && o.status === 'CONFIRMED')
        .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
    const lines = d.order_id ? getOrderLines(d.order_id) : [];
    const line = ORDER_LINES.find(l => l.id === d.order_line_id);
    const order = line ? getOrderById(line.order_id) : null;
    const serials = (line?.serial_nos || []).filter(s => s.trim());
    const ready = ticketDraftReady();
    const snap = ready ? buildTicketSnapshot(order, line, d.serial_no) : null;

    // Keep typed text across re-renders triggered by picker clicks.
    const keep = id => document.getElementById(id)?.value;
    ['tk-subject', 'tk-description', 'tk-reported'].forEach(id => {
        const v = keep(id);
        if (v !== undefined) d[{ 'tk-subject': 'subject', 'tk-description': 'description', 'tk-reported': 'reported_by' }[id]] = v;
    });

    showModal(`
        <div style="display:flex;flex-direction:column;max-height:86vh">
        <div style="flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr)">
            <div style="min-height:0;padding:26px 28px;overflow-y:auto;border-right:1px solid var(--border-light)">
                <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1432E6">Service Desk</div>
                <div style="font-size:20px;font-weight:700;margin-top:2px">New Ticket</div>
                <div style="font-size:12.5px;color:#86868b;margin-top:2px">Pick what the request is about. Only confirmed orders are eligible.</div>

                <div class="tk-step"><span class="n">1</span>Customer</div>
                ${isCustomerView()
                    ? `<div class="tk-pick sel" style="cursor:default"><i class="ph ph-buildings" style="color:#1432E6"></i><span style="font-size:13px;font-weight:600">${esc(d.customer_name)}</span></div>`
                    : `<select class="input-field" onchange="tkSet('customer_name', this.value)">
                        <option value="">Select customer…</option>
                        ${customers.map(c => `<option value="${esc(c)}" ${c === d.customer_name ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                       </select>
                       <div class="field-hint">Grouped by customer name on confirmed orders.</div>`}

                <div class="tk-step"><span class="n">2</span>Order</div>
                ${d.customer_name ? (orders.length ? orders.map(o => {
                    const eligible = o.status === 'CONFIRMED';
                    return `<button class="tk-pick ${o.id === d.order_id ? 'sel' : ''} ${eligible ? '' : 'disabled'}" ${eligible ? `onclick="tkSet('order_id', '${o.id}')"` : 'disabled'} style="margin-bottom:6px">
                        <i class="ph ph-shopping-cart" style="color:#86868b"></i>
                        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${esc(o.order_no)}</div><div style="font-size:11.5px;color:#86868b">${esc(o.order_date || '')}${o.hw_supplier_name ? ` · HW ${esc(o.hw_supplier_name)}` : ''}${o.sw_supplier_name ? ` · SW ${esc(o.sw_supplier_name)}` : ''}</div></div>
                        ${eligible ? orderStatusBadge(o.status) : '<span class="badge badge-draft">Not eligible</span>'}
                    </button>`;
                }).join('') : '<div style="font-size:12.5px;color:#86868b;padding:8px 0">This customer has no confirmed order.</div>')
                : '<div style="font-size:12.5px;color:#c7c7cc;padding:8px 0">Select a customer first.</div>'}

                <div class="tk-step"><span class="n">3</span>Order line</div>
                ${d.order_id ? lines.map(l => `<button class="tk-pick ${l.id === d.order_line_id ? 'sel' : ''}" onclick="tkSet('order_line_id', '${l.id}')" style="margin-bottom:6px">
                        <span class="badge ${l.scope === 'HW' ? 'badge-hw' : 'badge-sw'}">${l.scope}</span>
                        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${esc(l.product_name)}${l.version ? ` <span style="font-weight:400;color:#86868b">v${esc(l.version)}</span>` : ''}</div>
                        <div style="font-size:11.5px;color:#86868b">Qty ${l.qty}${l.sla_plan ? ` · SLA ${esc(l.sla_plan)}` : ''} · ${l.scope === 'HW' ? (l.warranty_end ? `warranty to ${esc(l.warranty_end)}` : 'warranty not set') : (l.license_end ? `license to ${esc(l.license_end)}` : 'license period not set')}</div></div>
                    </button>`).join('')
                : '<div style="font-size:12.5px;color:#c7c7cc;padding:8px 0">Select an order first.</div>'}

                ${line && line.scope === 'HW' && serials.length ? `
                <div class="tk-step"><span class="n">4</span>Serial number</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    ${serials.map(s => `<button class="tk-pick ${s === d.serial_no ? 'sel' : ''}" onclick="ticketDraft.serial_no='${esc(s)}';renderTicketCreateModal()" style="width:auto;padding:6px 12px"><span class="tk-mono" style="background:transparent;padding:0">${esc(s)}</span></button>`).join('')}
                </div>
                <div class="field-hint">One unit per ticket. Two units with the same fault are two tickets.</div>` : ''}
            </div>

            <div style="min-height:0;padding:26px 28px;overflow-y:auto;background:var(--bg-subtle)">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin-bottom:8px">Entitlement</div>
                ${ready ? ticketEntitlementCard(snap, d.serial_no) : `<div style="border:1px dashed var(--border);border-radius:12px;padding:22px;text-align:center;font-size:12.5px;color:#86868b"><i class="ph ph-shield-check" style="font-size:22px;display:block;margin-bottom:6px"></i>Warranty / license and SLA appear here once a line${line && line.scope === 'HW' && serials.length ? ' and serial' : ''} is selected.</div>`}
                ${ready ? '<div style="font-size:11px;color:#86868b;margin-top:6px"><i class="ph ph-camera"></i> Copied onto the ticket at creation; later order edits do not change it.</div>' : ''}

                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin:20px 0 8px">Request</div>
                <div class="form-grid-two">
                    <div><label class="field-label">Channel <span class="req">*</span></label>
                        <select class="input-field" onchange="tkSetText('channel', this.value)" ${isCustomerView() ? 'disabled' : ''}>
                            ${TICKET_CHANNELS.map(c => `<option ${c === d.channel ? 'selected' : ''}>${c}</option>`).join('')}
                        </select></div>
                    <div><label class="field-label">Priority <span class="req">*</span></label>
                        <select class="input-field" onchange="tkSetText('priority', this.value)">
                            ${TICKET_PRIORITIES.map(p => `<option value="${p}" ${p === d.priority ? 'selected' : ''}>${p[0] + p.slice(1).toLowerCase()}</option>`).join('')}
                        </select></div>
                </div>
                <div style="margin-top:12px"><label class="field-label">Category <span class="req">*</span></label>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        ${TICKET_CATEGORIES.map(c => `<button class="tk-chip ${c === d.category ? 'active' : ''}" onclick="tkSet('category', '${esc(c)}')">${esc(c)}</button>`).join('')}
                    </div></div>
                <div style="margin-top:12px"><label class="field-label" for="tk-subject">Subject <span class="req">*</span></label>
                    <input id="tk-subject" class="input-field" maxlength="120" placeholder="One line the customer would recognise" value="${esc(d.subject)}" oninput="tkSetText('subject', this.value)"></div>
                <div style="margin-top:12px"><label class="field-label" for="tk-description">Description <span class="req">*</span></label>
                    <textarea id="tk-description" class="input-field" style="min-height:96px" placeholder="What happened, when, what was tried" oninput="tkSetText('description', this.value)">${esc(d.description)}</textarea></div>
                <div style="margin-top:12px"><label class="field-label" for="tk-reported">Reported by</label>
                    <input id="tk-reported" class="input-field" placeholder="Customer contact name / email" value="${esc(d.reported_by)}" oninput="tkSetText('reported_by', this.value)"></div>
                <div style="margin-top:12px"><label class="field-label">Attachments</label>
                    ${ticketAttachmentDropZone('tk-draft-files', "onTicketDraftFiles(this.files)")}
                    ${d.attachments.length ? `<div class="tk-att-list" style="margin-top:8px">${ticketAttachmentChips(d.attachments, 'removeTicketDraftAttachment')}</div>` : ''}
                    <div id="tk-att-error" class="field-error-text"></div>
                    <div class="field-hint">${TICKET_ATTACHMENT_HINT}</div></div>

                <p id="tk-error" style="display:none;font-size:12.5px;font-weight:600;color:#dc2626;margin-top:12px"></p>

                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:22px">
                    <button class="btn-secondary text-xs" onclick="closeModal()">Cancel</button>
                    <button class="btn-primary text-xs" ${ready ? '' : 'disabled style="opacity:.5;cursor:not-allowed"'} onclick="saveTicket()"><i class="ph ph-paper-plane-tilt"></i> Create ticket</button>
                </div>
            </div>
        </div>
        </div>
    `, true);
    // The wide modal defaults to padding; this one draws its own two columns.
    const card = document.querySelector('#modal-root .modal-card');
    if (card) { card.style.padding = '0'; card.style.overflow = 'hidden'; card.style.maxWidth = '62rem'; }
}

function saveTicket() {
    const d = ticketDraft;
    const errors = [];
    if (!ticketDraftReady()) errors.push('Pick an order line (and serial) first.');
    if (!d.subject.trim()) errors.push('Subject is required.');
    if (!d.description.trim()) errors.push('Description is required.');
    const errEl = document.getElementById('tk-error');
    if (errors.length) {
        if (errEl) { errEl.textContent = errors[0]; errEl.style.display = 'block'; }
        return;
    }
    const line = ORDER_LINES.find(l => l.id === d.order_line_id);
    const order = getOrderById(line.order_id);
    // A draft has unfilled serials and a cancelled order is no longer serviced.
    if (order?.status !== 'CONFIRMED') {
        if (errEl) { errEl.textContent = `${order?.order_no || 'That order'} is ${orderStatusLabel(order?.status)}. Only confirmed orders can take a ticket.`; errEl.style.display = 'block'; }
        return;
    }
    const now = new Date().toISOString();
    const authorName = d.reported_by.trim() || (isCustomerView() ? actingName() : order.customer_name);
    const ticket = {
        id: `tk-${Date.now()}`, ticket_no: nextTicketNo(),
        customer_name: order.customer_name, customer_org_id: order.customer_org_id ?? null,
        order_id: order.id, order_line_id: line.id, serial_no: d.serial_no, scope: line.scope,
        subject: d.subject.trim(), description: d.description.trim(),
        category: d.category, priority: d.priority, status: 'OPEN',
        channel: d.channel, reported_by: d.reported_by.trim(),
        snapshot: buildTicketSnapshot(order, line, d.serial_no),
        internal_state: 'NONE', internal_party: '', internal_since: null,
        created_at: now, updated_at: now, first_response_at: null, resolved_at: null,
    };
    const ok = commitPortalMutation(() => {
        TICKETS.unshift(ticket);
        // The description doubles as the opening message so the thread starts complete.
        TICKET_MESSAGES.push({
            id: `tm-${Date.now()}`, ticket_id: ticket.id, author_type: 'CUSTOMER',
            author_name: authorName.split(' · ')[0], is_internal: false, created_at: now, body: ticket.description,
            attachments: d.attachments.map(a => ({ ...a })),
        });
        logActivity('Ticket opened', ticket.ticket_no, `${ticket.subject} · ${ticket.snapshot.order_no}${ticket.serial_no ? ` · ${ticket.serial_no}` : ''}`);
    });
    if (!ok) return;
    closeModal();
    ticketDraft = null;
    if (currentView !== 'service-desk') navigate('service-desk'); else renderServiceDesk();
    showToast(`${ticket.ticket_no} opened`);
    showTicketDetail(ticket.id);
}

// ── Detail ──

let ticketReplyMode = 'reply'; // 'reply' | 'note'

function showTicketDetail(id) {
    const t = getTicketById(id);
    if (!t) return;
    if (isCustomerView() && t.customer_org_id !== activeOrgId()) return;
    const manage = canManageTickets();
    markTicketNotificationsRead(t.id);
    const staff = manage ? deskStaff().filter(u => u.id !== actingUser()?.id) : [];
    const messages = getTicketMessages(id).filter(m => manage || !m.is_internal);
    const fr = ticketFirstResponse(t);
    const order = getOrderById(t.order_id);
    const line = ORDER_LINES.find(l => l.id === t.order_line_id);
    const others = getOrderTickets(t.order_id).filter(x => x.id !== t.id);
    const closed = t.status === 'CLOSED';
    if (!manage) ticketReplyMode = 'reply';
    // Reply text and pending files survive re-renders of this modal, but not a switch to another ticket.
    if (ticketReplyDraft.ticketId !== t.id) ticketReplyDraft = { ticketId: t.id, text: '', attachments: [], notify: [] };
    const reply = ticketReplyDraft;

    const kv = (label, value) => `<div class="tk-kv"><span>${label}</span><span>${value}</span></div>`;
    const bomSummary = (line?.bom || []).map(b => `${b.qty > 1 ? `${b.qty}× ` : ''}${b.model}`).join(' · ');

    showModal(`
        <div style="display:flex;flex-direction:column;max-height:88vh">
        <div style="flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr)">
            <div style="min-height:0;padding:26px 28px;overflow-y:auto;display:flex;flex-direction:column">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                            <span style="font-size:18px;font-weight:700;color:#1d1d1f">${esc(t.ticket_no)}</span>
                            ${ticketStatusBadge(t.status)}${ticketPriorityBadge(t.priority)}
                            ${fr.overdue ? '<span class="badge badge-red">Overdue</span>' : ''}
                        </div>
                        <div style="font-size:15px;font-weight:600;color:#1d1d1f;margin-top:6px">${esc(t.subject)}</div>
                        <div style="font-size:12.5px;color:#86868b;margin-top:2px">${esc(t.customer_name)} · opened ${esc(ticketDateTime(t.created_at))} via ${esc(t.channel || '—')}${t.reported_by ? ` by ${esc(t.reported_by)}` : ''} · ${esc(t.category)}</div>
                    </div>
                    <button class="btn-ghost" onclick="closeModal()" title="Close"><i class="ph ph-x"></i></button>
                </div>

                ${isWaitingOnMe(t) ? `
                <div style="margin-top:14px;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #fcd34d;background:#fffbeb;border-radius:12px">
                    <i class="ph ph-bell-ringing" style="font-size:20px;color:#b45309"></i>
                    <div style="flex:1;min-width:0;font-size:12.5px;color:#92400e"><b>Waiting for your confirmation</b><br>${t.internal_referred_by ? `${esc(userNameById(t.internal_referred_by))} referred this to you` : 'Referred to you'} ${esc(ticketTimeAgo(t.internal_since))}.</div>
                    <button class="btn-primary text-xs" onclick="confirmTicketInternal('${t.id}')"><i class="ph ph-check"></i> Mark confirmed</button>
                </div>` : ''}
                <div style="margin-top:14px;flex:1">
                    ${messages.map(m => `
                    <div class="tk-msg ${m.is_internal ? 'internal' : ''}">
                        <div class="av ${m.author_type === 'CUSTOMER' ? 'av-c' : 'av-i'}">${esc(getUserInitials(m.author_name || (m.author_type === 'CUSTOMER' ? t.customer_name : 'AISO')))}</div>
                        <div style="min-width:0;flex:1">
                            <span class="who">${esc(m.author_name || '—')}</span>
                            <span class="badge ${m.is_internal ? 'badge-amber' : (m.author_type === 'CUSTOMER' ? 'badge-customer' : 'badge-zinc')}" style="margin-left:6px">${m.is_internal ? 'Internal note' : (m.author_type === 'CUSTOMER' ? 'Customer' : 'AISO')}</span>
                            <span class="when">${esc(ticketDateTime(m.created_at))}</span>
                            <div class="body">${esc(m.body)}</div>
                            ${m.is_internal && (m.notify_user_ids || []).length ? `<div style="font-size:11.5px;color:#86868b;margin-top:4px"><i class="ph ph-bell"></i> Notified ${esc(m.notify_user_ids.map(userNameById).filter(Boolean).join(', '))}</div>` : ''}
                            ${(m.attachments || []).length ? `<div class="tk-att-list" style="margin-top:8px">${ticketAttachmentGallery(m.attachments, m.id)}</div>` : ''}
                        </div>
                    </div>`).join('')}
                </div>

                ${!canReplyTickets() ? '' : closed ? '<div style="margin-top:14px;font-size:12.5px;color:#86868b;text-align:center">This ticket is closed. Reopen it from the status control to continue the conversation.</div>' : `
                <div style="margin-top:14px;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff">
                    ${manage ? `<div style="display:flex;gap:6px;margin-bottom:8px">
                        <button class="filter-tab ${ticketReplyMode === 'reply' ? 'active' : ''}" onclick="ticketReplyMode='reply';showTicketDetail('${t.id}')">Reply to customer</button>
                        <button class="filter-tab ${ticketReplyMode === 'note' ? 'active' : ''}" onclick="ticketReplyMode='note';showTicketDetail('${t.id}')">Internal note</button>
                    </div>` : ''}
                    <textarea id="tk-reply" class="input-field" style="min-height:64px;${ticketReplyMode === 'note' ? 'background:#fffbeb;border-color:#fde68a' : ''}" placeholder="${ticketReplyMode === 'note' ? 'Note for the desk only. The customer never sees this.' : (manage ? 'Write a reply to the customer…' : 'Write a message to AISO…')}" oninput="ticketReplyDraft.text=this.value">${esc(reply.text)}</textarea>
                    ${reply.attachments.length ? `<div class="tk-att-list" style="margin-top:8px">${ticketAttachmentChips(reply.attachments, 'removeTicketReplyAttachment')}</div>` : ''}
                    ${ticketReplyMode === 'note' ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">
                        <span style="font-size:11.5px;font-weight:600;color:#86868b"><i class="ph ph-bell"></i> Notify</span>
                        ${staff.length ? staff.map(u => `<button class="tk-chip ${(reply.notify || []).includes(u.id) ? 'active' : ''}" style="padding:4px 10px;font-size:12px" onclick="toggleReplyNotify('${u.id}')">${esc(u.name)}</button>`).join('')
                            : '<span style="font-size:11.5px;color:#86868b">No AISO colleagues with ticket access yet — add people to AISO under Organizations.</span>'}
                    </div>` : ''}
                    <div id="tk-att-error" class="field-error-text"></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px">
                        <label class="btn-secondary text-xs" style="cursor:pointer" title="${esc(TICKET_ATTACHMENT_HINT)}"><i class="ph ph-paperclip"></i> Attach<input type="file" multiple accept="${TICKET_ATTACHMENT_ACCEPT}" style="display:none" onchange="onTicketReplyFiles(this.files)"></label>
                        <div style="display:flex;gap:8px">
                            ${manage && ticketReplyMode === 'reply' && t.status !== 'AWAITING_CUSTOMER_INFO' ? `<button class="btn-secondary text-xs" onclick="postTicketMessage('${t.id}', { thenStatus: 'AWAITING_CUSTOMER_INFO' })">Send & mark awaiting customer</button>` : ''}
                            <button class="btn-primary text-xs" onclick="postTicketMessage('${t.id}')"><i class="ph ph-paper-plane-tilt"></i> ${ticketReplyMode === 'note' ? 'Add note' : 'Send'}</button>
                        </div>
                    </div>
                </div>`}
            </div>

            <div style="min-height:0;padding:26px 24px;overflow-y:auto;background:var(--bg-subtle);border-left:1px solid var(--border-light)">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin-bottom:8px">Status</div>
                ${manage ? `<select class="input-field" onchange="setTicketStatus('${t.id}', this.value)">
                    ${TICKET_STATUSES.map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${TICKET_STATUS_LABEL[s]}</option>`).join('')}
                </select>` : `<div>${ticketStatusBadge(t.status)}</div>`}
                ${manage ? `
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin:16px 0 8px">Internal handling</div>
                <select class="input-field" onchange="setTicketInternalState('${t.id}', this.value)">
                    ${TICKET_INTERNAL_STATES.map(st => `<option value="${st}" ${st === ticketInternalState(t) ? 'selected' : ''}>${TICKET_INTERNAL_STATE_LABEL[st]}</option>`).join('')}
                </select>
                ${isTicketReferred(t) ? `<div style="margin-top:8px">${ticketInternalChip(t)}</div>
                ${t.internal_note ? `<div style="font-size:11.5px;color:#86868b;margin-top:6px">${esc(t.internal_note)}</div>` : ''}` : ''}
                <div class="field-hint" style="margin-top:6px">Desk only. The customer keeps seeing ${esc(TICKET_STATUS_LABEL[t.status])}.</div>` : ''}
                <div style="margin-top:14px">
                    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#86868b;margin-bottom:4px"><span>Handled by</span><b style="color:#1d1d1f">AISO Service Desk</b></div>
                    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#86868b;margin-bottom:4px">
                        <span>First response · ${fr.targetHours}h target${t.snapshot?.sla_plan ? ` (SLA ${esc(t.snapshot.sla_plan)})` : ''}</span>
                        <b style="color:${fr.overdue ? '#dc2626' : (fr.answered ? '#047857' : '#1d1d1f')}">${fr.answered ? `answered in ${fr.elapsedHours < 1 ? `${Math.round(fr.elapsedHours * 60)}m` : `${Math.round(fr.elapsedHours)}h`}` : `${Math.round(fr.elapsedHours)}h${fr.overdue ? ' · overdue' : ' · waiting'}`}</b>
                    </div>
                    <div class="tk-sla-bar"><i style="width:${Math.round(fr.ratio * 100)}%;background:${fr.overdue ? '#ef4444' : (fr.answered ? '#10b981' : '#f59e0b')}"></i></div>
                </div>

                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin:20px 0 8px">Entitlement snapshot</div>
                ${ticketEntitlementCard(t.snapshot || {}, t.serial_no)}

                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin:20px 0 8px">Order</div>
                ${kv('Order', order ? `<a href="#" onclick="event.preventDefault();closeModal();showOrderDetail('${order.id}')" style="color:#1432E6;font-weight:600">${esc(t.snapshot?.order_no || order.order_no)}</a>` : esc(t.snapshot?.order_no || '—'))}
                ${kv('Line', `${t.snapshot?.line_no ?? '—'} · ${esc(t.scope)} · ${esc(t.snapshot?.product_name || '—')}`)}
                ${t.serial_no ? kv('Serial', `<span class="tk-mono">${esc(t.serial_no)}</span>`) : ''}
                ${bomSummary ? kv('BOM', esc(bomSummary)) : ''}
                ${kv('Category', esc(t.category))}
                ${kv('Channel', esc(t.channel || '—'))}

                ${others.length ? `
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;margin:20px 0 8px">Other tickets on this order</div>
                ${others.map(x => `<a href="#" onclick="event.preventDefault();showTicketDetail('${x.id}')" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;font-size:12.5px;color:#1d1d1f;text-decoration:none"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.ticket_no)} · ${esc(x.subject)}</span>${ticketStatusBadge(x.status)}</a>`).join('')}` : ''}
            </div>
        </div>
        </div>
    `, true);
    const card = document.querySelector('#modal-root .modal-card');
    if (card) { card.style.padding = '0'; card.style.overflow = 'hidden'; card.style.maxWidth = '68rem'; }
}

function postTicketMessage(ticketId, { thenStatus = null } = {}) {
    if (!canReplyTickets()) { showToast('Your role cannot reply to tickets.', 'error'); return; }
    const t = getTicketById(ticketId);
    const body = (document.getElementById('tk-reply')?.value || '').trim();
    const attachments = ticketReplyDraft.ticketId === ticketId ? ticketReplyDraft.attachments.map(a => ({ ...a })) : [];
    if (!t || (!body && !attachments.length)) { showToast('Write a message or attach a file first.', 'error'); return; }
    const manage = canManageTickets();
    const isNote = manage && ticketReplyMode === 'note';
    const notify = isNote && ticketReplyDraft.ticketId === ticketId ? [...(ticketReplyDraft.notify || [])] : [];
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        const msgId = `tm-${Date.now()}`;
        TICKET_MESSAGES.push({
            id: msgId, ticket_id: t.id,
            author_type: manage ? 'INTERNAL' : 'CUSTOMER',
            author_name: actingName(),
            is_internal: isNote, created_at: now, body, attachments,
            ...(notify.length ? { notify_user_ids: notify } : {}),
        });
        if (notify.length) notifyUsers(notify, t, 'NOTE', msgId);
        t.updated_at = now;
        if (manage && !isNote) {
            if (!t.first_response_at) t.first_response_at = now;
            if (thenStatus) t.status = thenStatus;
            else if (t.status === 'OPEN') t.status = 'IN_PROGRESS';
        }
        // A customer answering an information request puts the ball back with the desk.
        if (!manage && t.status === 'AWAITING_CUSTOMER_INFO') t.status = 'IN_PROGRESS';
        logActivity(isNote ? 'Ticket note added' : (manage ? 'Ticket replied' : 'Customer replied'), t.ticket_no, (body || `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`).slice(0, 80));
    });
    if (!ok) return;
    ticketReplyMode = 'reply';
    ticketReplyDraft = { ticketId: null, text: '', attachments: [], notify: [] };
    renderServiceDesk();
    showTicketDetail(t.id);
}

function setTicketStatus(ticketId, status) {
    const t = getTicketById(ticketId);
    if (!t || !canManageTickets() || !TICKET_STATUSES.includes(status) || t.status === status) return;
    const now = new Date().toISOString();
    const ok = commitPortalMutation(() => {
        const from = t.status;
        t.status = status;
        t.updated_at = now;
        if (status === 'RESOLVED' || status === 'CLOSED') {
            t.resolved_at = t.resolved_at || now;
            // Nobody is being waited on once the ticket is done.
            t.internal_state = 'NONE';
            t.internal_party = '';
            t.internal_since = null;
            t.internal_assignee_id = null;
            t.internal_referred_by = null;
        } else t.resolved_at = null;
        logActivity('Ticket status changed', t.ticket_no, `${TICKET_STATUS_LABEL[from]} → ${TICKET_STATUS_LABEL[status]}`);
    });
    if (!ok) return;
    renderServiceDesk();
    showTicketDetail(t.id);
    showToast(`${t.ticket_no} marked ${TICKET_STATUS_LABEL[status].toLowerCase()}`);
}

// ── Attachments ──
// Files live inside the message as data URLs so a ticket survives a reload
// with no backend. Images are resized by Store.compressImage; other files
// are kept only while small, since everything has to fit in localStorage.

const TICKET_ATTACHMENT_MAX_COUNT = 5;
const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1000 * 1000;
const TICKET_ATTACHMENT_STORE_BYTES = 500 * 1000;
const TICKET_ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.pdf,.txt,.log,.csv,.json';
const TICKET_ATTACHMENT_HINT = 'PNG, JPG, PDF, TXT, LOG, CSV or JSON. Up to 5 files; images up to 5 MB, other files up to 500 KB.';

let ticketReplyDraft = { ticketId: null, text: '', attachments: [] };

function ticketAttachmentKind(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (file.type === 'image/png' || file.type === 'image/jpeg' || ['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
    if (['pdf', 'txt', 'log', 'csv', 'json'].includes(ext)) return 'file';
    return null;
}

function formatFileSize(bytes) {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
    return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('File read failed'));
        r.readAsDataURL(file);
    });
}

// Validate and read a FileList; returns what could be added plus the first error.
async function readTicketAttachments(fileList, existing, maxCount = TICKET_ATTACHMENT_MAX_COUNT) {
    const added = [];
    let error = '';
    for (const file of Array.from(fileList || [])) {
        if (existing.length + added.length >= maxCount) { error = `You can attach up to ${maxCount} files.`; break; }
        const kind = ticketAttachmentKind(file);
        if (!kind) { error = `${file.name}: unsupported file type.`; continue; }
        if (file.size > TICKET_ATTACHMENT_MAX_BYTES) { error = `${file.name} exceeds the 5 MB limit.`; continue; }
        if (kind === 'file' && file.size > TICKET_ATTACHMENT_STORE_BYTES) { error = `${file.name}: files other than images must be under 500 KB in this prototype.`; continue; }
        try {
            const data_url = kind === 'image' ? await Store.compressImage(file) : await readFileAsDataUrl(file);
            added.push({ id: `att-${Date.now()}-${added.length}`, name: file.name, type: file.type || '', size: file.size, is_image: kind === 'image', data_url });
        } catch (e) {
            error = `${file.name} could not be read.`;
        }
    }
    return { added, error };
}

function setTicketAttachmentError(msg) {
    const el = document.getElementById('tk-att-error');
    if (el) el.textContent = msg || '';
}

function ticketAttachmentDropZone(inputId, onFiles) {
    return `<label class="tk-att-drop" for="${inputId}"
        ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
        ondrop="event.preventDefault();this.classList.remove('over');${onFiles.replace('this.files', 'event.dataTransfer.files')}">
        <i class="ph ph-paperclip" style="font-size:16px"></i><span>Drop files here or click to choose</span>
        <input id="${inputId}" type="file" multiple accept="${TICKET_ATTACHMENT_ACCEPT}" onchange="${onFiles};this.value=''">
    </label>`;
}

// Pending files with a remove control (create modal, reply box).
function ticketAttachmentChips(list, removeFn) {
    return list.map((a, i) => `<span class="tk-att-chip" title="${esc(a.name)}">
        <i class="ph ${a.is_image ? 'ph-image' : 'ph-file-text'}"></i><span class="nm">${esc(a.name)}</span><span class="sz">${formatFileSize(a.size)}</span>
        <button class="rm" onclick="${removeFn}(${i})" title="Remove"><i class="ph ph-x"></i></button>
    </span>`).join('');
}

// Stored files on a message: image thumbnails open a preview, others download.
function ticketAttachmentGallery(list, messageId) {
    return list.map((a, i) => a.is_image
        ? `<img class="tk-att-thumb" src="${a.data_url}" alt="${esc(a.name)}" title="${esc(a.name)}" onclick="showTicketAttachmentPreview('${messageId}', ${i})">`
        : `<a class="tk-att-chip" href="${a.data_url}" download="${esc(a.name)}" title="Download ${esc(a.name)}">
            <i class="ph ph-file-text"></i><span class="nm">${esc(a.name)}</span><span class="sz">${formatFileSize(a.size)}</span><i class="ph ph-download-simple"></i>
           </a>`).join('');
}

function showTicketAttachmentPreview(messageId, index) {
    const m = TICKET_MESSAGES.find(x => x.id === messageId);
    const a = m?.attachments?.[index];
    if (!a) return;
    document.getElementById('tk-preview-root').innerHTML = `
        <div class="tk-preview" onclick="closeTicketAttachmentPreview()">
            <img src="${a.data_url}" alt="${esc(a.name)}">
            <div class="cap">${esc(a.name)} · ${formatFileSize(a.size)} · click anywhere to close</div>
        </div>`;
}
function closeTicketAttachmentPreview() { document.getElementById('tk-preview-root').innerHTML = ''; }

async function onTicketDraftFiles(fileList) {
    if (!ticketDraft) return;
    const { added, error } = await readTicketAttachments(fileList, ticketDraft.attachments);
    ticketDraft.attachments.push(...added);
    if (added.length) renderTicketCreateModal();
    setTicketAttachmentError(error);
}
function removeTicketDraftAttachment(i) {
    ticketDraft.attachments.splice(i, 1);
    renderTicketCreateModal();
}

async function onTicketReplyFiles(fileList) {
    const text = document.getElementById('tk-reply')?.value;
    if (text !== undefined) ticketReplyDraft.text = text;
    const { added, error } = await readTicketAttachments(fileList, ticketReplyDraft.attachments);
    ticketReplyDraft.attachments.push(...added);
    if (added.length) showTicketDetail(ticketReplyDraft.ticketId);
    setTicketAttachmentError(error);
}
function removeTicketReplyAttachment(i) {
    const text = document.getElementById('tk-reply')?.value;
    if (text !== undefined) ticketReplyDraft.text = text;
    ticketReplyDraft.attachments.splice(i, 1);
    showTicketDetail(ticketReplyDraft.ticketId);
}

// Bootstrap last: restoring a session renders the sidebar, nav and View as
// switch, so every declaration they read must already be initialized.
initPortal();
