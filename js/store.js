// ═══════════════════════════════════════════════════════════════════
// STORE — localStorage persistence layer
// Load order: seed-data.js → store.js → app.js
// Persisted state: PRODUCTS, ACTIVITY_LOG, HARDWARE_PRODUCT_TYPES,
//                  SOFTWARE_CATEGORY_OPTIONS, SOFTWARE_INDUSTRY_OPTIONS
// ═══════════════════════════════════════════════════════════════════

const Store = (function () {
    // v3 uses a separate key so it never reads or overwrites v2 prototype data.
    const KEY = 'aiso-portal-v3-mvp';
    // v2: licensing options became static (SOFTWARE_LICENSE_OPTIONS removed).
    const VERSION = 2;
    const IMG_MAX_WIDTH = 800;
    const IMG_JPEG_QUALITY = 0.8;

    function serialize() {
        return JSON.stringify({
            version: VERSION,
            mockDataVersion: typeof MOCK_DATA_VERSION === 'undefined' ? 0 : MOCK_DATA_VERSION,
            savedAt: new Date().toISOString(),
            PRODUCTS,
            ACTIVITY_LOG,
            HARDWARE_PRODUCT_TYPES,
            SOFTWARE_CATEGORY_OPTIONS,
            SOFTWARE_INDUSTRY_OPTIONS,
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
                    const seedCreatedEntry = seedProduct?.history?.find(entry => entry.action === 'Created');
                    if (!seedCreatedEntry || product.history?.some(entry => entry.action === 'Created')) return product;
                    return { ...product, history: [...(product.history || []), { ...seedCreatedEntry }] };
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
        if (mockDataMigrated || industriesNormalized) {
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
