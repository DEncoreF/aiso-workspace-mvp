// ═══════════════════════════════════════════════════════════════════
// STORE — localStorage persistence layer
// Load order: seed-data.js → store.js → app.js
// Persisted state: PRODUCTS, ASSETS, ORDERS, ORDER_LINES, TICKETS,
//                  TICKET_MESSAGES, NOTIFICATIONS, ORGS, USERS, ROLES, ROLE_BINDINGS,
//                  ACTIVITY_LOG, HARDWARE_PRODUCT_TYPES,
//                  SOFTWARE_CATEGORY_OPTIONS, SOFTWARE_INDUSTRY_OPTIONS
// ═══════════════════════════════════════════════════════════════════

const Store = (function () {
    // v4 uses a separate key so it never reads or overwrites v3 prototype data.
    const KEY = 'aiso-portal-v4-mvp';
    // v4.4: HW order lines gained warranty term and period.
    // v4.5: Organization Management — ORGS reshaped (types[], members moved
    //       out) and persisted, plus USERS / ROLES / ROLE_BINDINGS.
    const VERSION = 8;
    const IMG_MAX_WIDTH = 800;
    const IMG_JPEG_QUALITY = 0.8;

    function serialize() {
        return JSON.stringify({
            version: VERSION,
            mockDataVersion: typeof MOCK_DATA_VERSION === 'undefined' ? 0 : MOCK_DATA_VERSION,
            savedAt: new Date().toISOString(),
            PRODUCTS,
            ASSETS,
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
            aisoDeskSeeded: true,
        });
    }

    function save({ notify = true } = {}) {
        try {
            localStorage.setItem(KEY, serialize());
            return true;
        } catch (e) {
            console.error('Store.save failed:', e);
            if (notify && typeof showToast === 'function') {
                // Same copy as app.js's TOAST_SAVE_FAILURE, inlined because
                // store.js loads first and must not depend on app.js.
                showToast('Changes could not be saved. Please try again.', 'error');
            }
            return false;
        }
    }

    function load() {
        let raw = null;
        try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
        if (!raw) return false;

        let data;
        try { data = JSON.parse(raw); } catch (e) {
            localStorage.removeItem(KEY);
            return false;
        }
        // Schema changed since this save was written → discard and fall back to seed
        if (!data || data.version !== VERSION) {
            localStorage.removeItem(KEY);
            return false;
        }

        let mockDataMigrated = false;
        if (Array.isArray(data.PRODUCTS)) {
            const seedMockProducts = PRODUCTS.filter(product => product.is_mock);
            if (data.mockDataVersion !== MOCK_DATA_VERSION) {
                const seedProductsById = new Map(PRODUCTS.map(product => [product.id, product]));
                const migratedProducts = data.PRODUCTS.map(product => {
                    const seedProduct = seedProductsById.get(product.id);
                    if (!seedProduct) return product;
                    // A newer seed may introduce fields the save predates (a product
                    // icon, a licensing offer). Fill in only what is absent: a field
                    // the user cleared holds '' or [], not undefined, so their edits
                    // are never overwritten.
                    let merged = product;
                    Object.keys(seedProduct).forEach(key => {
                        if (merged[key] !== undefined) return;
                        if (merged === product) merged = { ...product };
                        merged[key] = seedProduct[key];
                    });
                    const seedCreatedEntry = seedProduct.history?.find(entry => entry.action === 'Created');
                    if (!seedCreatedEntry || merged.history?.some(entry => entry.action === 'Created')) return merged;
                    return { ...merged, history: [...(merged.history || []), { ...seedCreatedEntry }] };
                });
                const persistedIds = new Set(migratedProducts.map(product => product.id));
                PRODUCTS = [...migratedProducts, ...seedMockProducts.filter(product => !persistedIds.has(product.id))];
                mockDataMigrated = true;
            } else {
                PRODUCTS = data.PRODUCTS;
            }
        }
        // Old saves may still hold abbreviated industry labels; map them onto the
        // Parameter Center vocabulary so a product never shows 'IT' next to the
        // option list's 'Information Technology'.
        let industriesNormalized = false;
        PRODUCTS.forEach(product => {
            if (!product.industries?.length) return;
            const normalized = normalizeIndustryLabels(product.industries);
            if (normalized.join('|') === product.industries.join('|')) return;
            product.industries = normalized;
            industriesNormalized = true;
        });

        if (Array.isArray(data.ASSETS)) ASSETS = data.ASSETS;
        if (Array.isArray(data.ORDERS)) ORDERS = data.ORDERS;
        if (Array.isArray(data.ORDER_LINES)) ORDER_LINES = data.ORDER_LINES;
        // Saves from before license-to-serial binding hold license keys as plain
        // strings; they become unbound keys, which is what they meant.
        let licenseKeysNormalized = false;
        ORDER_LINES.forEach(line => {
            if (!(line.license_keys || []).some(k => typeof k === 'string')) return;
            line.license_keys = line.license_keys.map(k => typeof k === 'string' ? { key: k, unit: null } : k);
            licenseKeysNormalized = true;
        });
        // Saves written before the Service Desk shipped have no ticket arrays;
        // they keep the seed tickets rather than forcing a schema reset.
        if (Array.isArray(data.TICKETS)) TICKETS = data.TICKETS;
        // Customers raise tickets from the Workspace; the channel used to be
        // called "Portal form", which read like the public website.
        let channelsRenamed = false;
        TICKETS.forEach(t => { if (t.channel === 'Portal form') { t.channel = 'Workspace'; channelsRenamed = true; } });
        if (Array.isArray(data.TICKET_MESSAGES)) TICKET_MESSAGES = data.TICKET_MESSAGES;
        if (Array.isArray(data.NOTIFICATIONS)) NOTIFICATIONS = data.NOTIFICATIONS;
        if (Array.isArray(data.ORGS)) ORGS = data.ORGS;
        if (Array.isArray(data.USERS)) USERS = data.USERS;
        if (Array.isArray(data.ROLES)) ROLES = data.ROLES;
        if (Array.isArray(data.ROLE_BINDINGS)) ROLE_BINDINGS = data.ROLE_BINDINGS;
        // Saves from before the AISO desk colleagues were seeded get them once.
        // The flag stops a later removal in the UI from being undone on reload.
        let aisoDeskAdded = false;
        if (!data.aisoDeskSeeded) {
            const addMissing = (list, ids) => seed => {
                if (ids.includes(seed.id) && !list.some(x => x.id === seed.id)) { list.push({ ...seed }); aisoDeskAdded = true; }
            };
            SEED_AISO_DESK.roles.forEach(addMissing(ROLES, ['r-aiso-desk']));
            SEED_AISO_DESK.users.forEach(addMissing(USERS, ['u-aiso-kevin', 'u-aiso-ivy']));
            SEED_AISO_DESK.bindings.forEach(addMissing(ROLE_BINDINGS, ['rb-aiso-kevin', 'rb-aiso-ivy']));
        }

        if (Array.isArray(data.ACTIVITY_LOG)) {
            if (data.mockDataVersion !== MOCK_DATA_VERSION) {
                const createdProductNames = new Set(
                    data.ACTIVITY_LOG
                        .filter(log => log.action === 'Created')
                        .map(log => log.productName)
                );
                ACTIVITY_LOG = [
                    ...data.ACTIVITY_LOG,
                    ...SEED_PRODUCT_CREATED_LOGS.filter(log => !createdProductNames.has(log.productName)),
                ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            } else {
                ACTIVITY_LOG = data.ACTIVITY_LOG;
            }
        }
        if (Array.isArray(data.HARDWARE_PRODUCT_TYPES)) HARDWARE_PRODUCT_TYPES = data.HARDWARE_PRODUCT_TYPES;
        if (Array.isArray(data.SOFTWARE_CATEGORY_OPTIONS)) SOFTWARE_CATEGORY_OPTIONS = data.SOFTWARE_CATEGORY_OPTIONS;
        if (Array.isArray(data.SOFTWARE_INDUSTRY_OPTIONS)) SOFTWARE_INDUSTRY_OPTIONS = data.SOFTWARE_INDUSTRY_OPTIONS;
        if (mockDataMigrated || industriesNormalized || licenseKeysNormalized || channelsRenamed || aisoDeskAdded || !data.aisoDeskSeeded) {
            try { localStorage.setItem(KEY, serialize()); } catch (e) { /* retry on the next normal save */ }
        }
        return true;
    }

    function reset() {
        try {
            localStorage.removeItem(KEY);
            location.reload();
            return true;
        } catch (e) {
            console.error('Store.reset failed:', e);
            if (typeof showToast === 'function') {
                showToast('Unable to reset demo data. Please try again.', 'error');
            }
            return false;
        }
    }

    // Resize + re-encode an image File to a data URL small enough for localStorage.
    // PNG sources keep PNG (preserves icon transparency); everything else becomes JPEG.
    function compressImage(file, maxWidth = IMG_MAX_WIDTH, quality = IMG_JPEG_QUALITY) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.naturalWidth);
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                const isPng = file.type === 'image/png';
                resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Image decode failed'));
            };
            img.src = url;
        });
    }

    return { save, load, reset, compressImage };
})();

// Hydrate state from localStorage (if a valid save exists) before app.js runs.
Store.load();
