// ═══════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════

const SUPER_ADMIN_USER = {
    role: 'SUPER_ADMIN',
    name: 'System Root',
    email: 'root@aiso.com',
    label: 'Super Admin',
    avatar: 'SA',
    permissions: ['*'],
};
const DEMO_LOGIN = { email: 'root@aiso.com', password: 'aiso1234' };

const ORGS = [
    { id: 'v-phison', name: 'Phison Electronics', type: 'vendor', vendor_type: 'hardware', status: 'active',
      members: [
        { id: 'm1', name: 'James Chen', email: 'james@phison.com', org_role: 'OA', status: 'active' },
        { id: 'm2', name: 'Kevin Wu', email: 'kevin@phison.com', org_role: 'CM', status: 'active' },
      ]
    },
    { id: 'v-tpi', name: 'TPIsoftware Corporation', type: 'vendor', vendor_type: 'software', status: 'active',
      members: [
        { id: 'm3', name: 'David Lin', email: 'david@tpisoftware.com', org_role: 'OA', status: 'active' },
        { id: 'm4', name: 'Grace Lee', email: 'grace@tpisoftware.com', org_role: 'CM', status: 'active' },
      ]
    },
    { id: 'v-kdan', name: 'KDAN', type: 'vendor', vendor_type: 'software', status: 'active',
      members: [
        { id: 'm5', name: 'Eric Wang', email: 'eric@kdan.com', org_role: 'OA', status: 'active' },
      ]
    },
    { id: 'c-megabank', name: 'MegaBank Corp', type: 'customer', vendor_type: null, status: 'active',
      members: [
        { id: 'm6', name: 'Tom Baker', email: 'tom@megabank.com', org_role: 'OA', status: 'active' },
        { id: 'm7', name: 'Amy Zhang', email: 'amy@megabank.com', org_role: 'CM', status: 'active' },
      ]
    },
    { id: 'c-govcloud', name: 'GovCloud Agency', type: 'customer', vendor_type: null, status: 'active',
      members: [
        { id: 'm8', name: 'Robert Kim', email: 'robert@govcloud.gov', org_role: 'OA', status: 'active' },
      ]
    },
];

let PRODUCTS = [
    // === HARDWARE ===
    {
        id: 'hw1', product_type: 'hardware', product_format: 'standard', vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
        name: 'GIGABYTE Workstation', model: 'W773-80', brand: 'GIGABYTE', sub_category: 'Workstation', display_order: 1,
        short_description: 'Professional AI workstation for AI engineers and data scientists.',
        status: 'published', created_at: '2026-01-15', updated_at: '2026-03-10',
        is_aidaptiv: true,
        key_specifications: [
            'Intel Core Ultra 9 185H (60 Core)',
            'NVIDIA Pro6000 Blackwell Max-Q 96GB x2',
            '8x DDR5 5600 64GB',
            'Phison X200 7680GB x2 (aiDAPTIV Cache)',
            '2x 960GB SATA SSD RAID 1',
            'Ubuntu 24.04',
        ],
        bestFor: ['AI Platform', 'Visual Effects', 'HPC', 'Data Science'],
    },
    {
        id: 'hw2', product_type: 'hardware', product_format: 'standard', vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
        name: 'Gigacomputing 4U Server (4x GPU)', model: 'G494-SB4-AAP2', brand: 'Gigacomputing', sub_category: 'Rack Server', display_order: 2,
        short_description: 'Enterprise AI inference server with 4x GPU configuration.',
        status: 'published', created_at: '2026-01-10', updated_at: '2026-03-08',
        is_aidaptiv: true,
        key_specifications: [
            '2x Intel Xeon 6730P 32Core',
            '4x NVIDIA Pro6000 Blackwell 96GB',
            '16x DDR5 5600 64GB',
            '4x Phison X200 7680GB (aiDAPTIV Cache)',
            'Dual 10Gb LAN',
            'Ubuntu 24.04',
        ],
        bestFor: ['AI Training', 'Multi-model Inference', 'Enterprise AI'],
    },
    {
        id: 'hw3', product_type: 'hardware', product_format: 'standard', vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
        name: 'Gigacomputing 4U Server (8x GPU)', model: 'G494-SB4-AAP2', brand: 'Gigacomputing', sub_category: 'Rack Server', display_order: 3,
        short_description: 'Large-scale AI training server with 8x GPU for maximum parallel processing.',
        status: 'draft', created_at: '2026-03-01', updated_at: '2026-03-18',
        is_aidaptiv: false,
        key_specifications: [
            '2x Intel Xeon 6730P 32Core',
            '8x NVIDIA Pro6000 Blackwell 96GB',
            '16x DDR5 5600 64GB',
            'Dual 10Gb LAN',
            'Ubuntu 24.04',
        ],
        bestFor: ['Large-scale Training', 'LLM Fine-tuning', 'HPC'],
    },
    // === SOFTWARE ===
    {
        id: 'sw1', product_type: 'software', vendor_id: 'v-tpi', vendor_name: 'TPIsoftware Corporation',
        name: 'digiRunner', sub_category: 'AI Governance Platform', categories: ['AI Governance Platform', 'Cybersecurity'], display_order: 1,
        short_description: 'AI Governance Platform for Enhanced Security and Cost Observability',
        status: 'published', created_at: '2025-11-20', updated_at: '2026-03-12',
        tagline: 'AI Governance Platform for Enhanced Security and Cost Observability',
        icon_name: 'digirunner.svg', icon_data: 'images/product-icons/digirunner.svg',
        sw_category: 'included',
        license_offer: 'Free during POC',
        features: [
            'Centralizes management of AI models and LLMs; monitors API usage',
            'Improves system performance with microservices architecture',
            'Access control through encryption and authentication',
            'Real-time token consumption insights',
        ],
        industries: ['IoT', 'Banking & Finance', 'Healthcare', 'E-commerce & Retail', 'Information Technology', 'Manufacturing', 'Government & Public Sector'],
        officialUrl: 'https://www.tpisoftware.com',
        videoUrl: 'https://www.youtube.com/watch?v=demo1',
    },
    {
        id: 'sw2', product_type: 'software', vendor_id: 'v-tpi', vendor_name: 'TPIsoftware Corporation',
        name: 'SysTalk.VIKI', sub_category: 'Enterprise GenAI Platform', categories: ['Enterprise GenAI Platform', 'Business Applications'], display_order: 2,
        short_description: 'Enterprise Generative AI Application Platform for knowledge management',
        status: 'published', created_at: '2025-10-15', updated_at: '2026-03-10',
        tagline: 'Enterprise Generative AI Application Platform',
        icon_name: 'systalk-viki.svg', icon_data: 'images/product-icons/systalk-viki.svg',
        sw_category: 'included',
        license_offer: '30-day free trial',
        features: [
            'Enterprise-Grade Knowledge Integration & Governance',
            'Multi-Role AI Assistants for Diverse Business Scenarios',
            'Natural Language Interaction with High-Accuracy Knowledge Retrieval',
            'Scalable, Modular Architecture for Rapid AI Adoption',
        ],
        industries: ['Banking & Finance', 'Healthcare', 'E-commerce & Retail', 'Information Technology', 'Manufacturing', 'Government & Public Sector'],
        officialUrl: 'https://www.tpisoftware.com',
        videoUrl: '',
    },
    {
        id: 'sw3', product_type: 'software', vendor_id: 'v-tpi', vendor_name: 'TPIsoftware Corporation',
        name: 'OrientAI Express', sub_category: 'AI Knowledge & Assistant Platform', categories: ['AI Knowledge & Assistant Platform'], display_order: 3,
        short_description: 'Agile AI Knowledge & Assistant Platform',
        status: 'draft', created_at: '2026-02-10', updated_at: '2026-03-19',
        tagline: 'Agile AI Knowledge & Assistant Platform',
        icon_name: 'orientai-express.svg', icon_data: 'images/product-icons/orientai-express.svg',
        sw_category: 'optional',
        license_offer: 'First year free',
        compatible_hardware: ['hw1', 'hw2'],
        features: [
            'Agile knowledge management with rapid, zero-configuration deployment.',
            'Secure, scalable edge architecture with full data sovereignty and no cloud dependency.',
            'Flexible LLM selection for optimized contextual applications.',
            'Purpose-built AI assistants for diverse enterprise workflows and use cases.',
        ],
        industries: ['IoT', 'Banking & Finance', 'Healthcare', 'E-commerce & Retail', 'Information Technology', 'Manufacturing', 'Government & Public Sector'],
        officialUrl: 'https://www.tpisoftware.com',
        videoUrl: '',
    },
    {
        id: 'sw4', product_type: 'software', vendor_id: 'v-tpi', vendor_name: 'TPIsoftware Corporation',
        name: 'digiFlexis', sub_category: 'BPM Platform', categories: ['BPM Platform'], display_order: 4,
        short_description: 'Business Process Management Platform for Integrated Workflow Automation',
        status: 'draft', created_at: '2026-03-15', updated_at: '2026-03-20',
        tagline: 'Business Process Management Platform for Integrated Workflow Automation',
        icon_name: 'digiflexis.svg', icon_data: 'images/product-icons/digiflexis.svg',
        license_offer: '90-day free trial',
        sw_category: 'optional',
        compatible_hardware: ['hw1'],
        features: [
            'Form Builder with drag-and-drop customization',
            'Workflow Design with conditional logic and batch approvals',
            'Automated Notifications with deadline alerts',
            'Cloud-based API Integration',
        ],
        industries: ['Banking & Finance', 'Healthcare', 'E-commerce & Retail', 'Information Technology', 'Manufacturing', 'Government & Public Sector'],
        officialUrl: 'https://www.tpisoftware.com',
        videoUrl: '',
    },
    {
        id: 'sw5', product_type: 'software', vendor_id: 'v-kdan', vendor_name: 'KDAN',
        name: 'ComPDF AI', sub_category: 'Document Processing', categories: ['Document Processing'], display_order: 5,
        short_description: 'Intelligent Document Processing & Automation Platform',
        status: 'published', created_at: '2026-01-05', updated_at: '2026-03-15',
        tagline: 'Intelligent Document Processing & Automation Platform',
        icon_name: 'compdf-ai.svg', icon_data: 'images/product-icons/compdf-ai.svg',
        license_offer: 'First year free',
        sw_category: 'optional',
        compatible_hardware: ['hw1', 'hw2'],
        features: [
            'End-to-End Document Automation workflow',
            'Flexible Deployment options (self-hosted, private/public cloud)',
            'AI + Rule Hybrid Models combining NLP, CV, OCR',
            'High-speed processing with up to 99% accuracy',
        ],
        industries: ['Government & Public Sector', 'Banking & Finance', 'Healthcare', 'Logistics & Transportation', 'Education', 'Legal & Consulting', 'Manufacturing'],
        officialUrl: 'https://www.compdf.com',
        videoUrl: 'https://www.youtube.com/watch?v=demo2',
    },
    {
        id: 'sw6', product_type: 'software', vendor_id: 'v-tpi', vendor_name: 'TPIsoftware Corporation',
        name: 'GreenSwift', sub_category: 'ESG / Carbon Management', categories: ['ESG / Carbon Management'], display_order: 6,
        short_description: 'AI-Driven Greenhouse Gas Emissions Management Platform',
        status: 'draft', created_at: '2026-03-18', updated_at: '2026-03-22',
        tagline: 'AI-Driven Greenhouse Gas Emissions Management Platform',
        icon_name: 'greenswift.svg', icon_data: 'images/product-icons/greenswift.svg',
        license_offer: 'Free during POC',
        sw_category: 'optional',
        compatible_hardware: [],
        features: [
            'Unified GHG emissions inventory management',
            'Automated emissions factor matching',
            'Multi-national emissions factor databases',
            'Group-wide aggregated GHG data reporting',
        ],
        industries: ['Banking & Finance', 'Healthcare', 'E-commerce & Retail', 'Information Technology', 'Manufacturing', 'Government & Public Sector'],
        officialUrl: 'https://www.tpisoftware.com',
        videoUrl: '',
    },
];

// Additional mock catalog entries keep both product lists above one page so
// pagination, filtering, sorting, archived states, and history expansion can
// be exercised without manually creating products.
const MOCK_DATA_VERSION = 5;
const MOCK_HARDWARE_PRODUCTS = [
    { name: 'EdgeCore AI MiniPC', model: 'EC-MP100', brand: 'EdgeCore', category: 'miniPC', status: 'published', aidaptiv: true, format: 'standard' },
    { name: 'VisionBox Edge AI', model: 'VB-AI200', brand: 'Aetina', category: 'AI Box', status: 'draft', aidaptiv: false, format: 'standard' },
    { name: 'NeuralRack 2U Inference Server', model: 'NR-2U400', brand: 'Supermicro', category: 'Rack Server', status: 'published', aidaptiv: true, format: 'standard' },
    { name: 'Liquid-Cooled Training Node', model: 'LC-TN800', brand: 'Inventec', category: 'Rack Server', status: 'archived', aidaptiv: true, format: 'nonstandard' },
    { name: 'AI Developer Notebook', model: 'ADN-16X', brand: 'GIGABYTE', category: 'AITNB', status: 'published', aidaptiv: false, format: 'standard' },
    { name: 'Compact AI Workstation', model: 'CAW-550', brand: 'ASUS', category: 'Workstation', status: 'draft', aidaptiv: true, format: 'standard' },
    { name: 'DataForge Storage Server', model: 'DF-4U120', brand: 'Gigacomputing', category: 'Rack Server', status: 'published', aidaptiv: true, format: 'standard' },
    { name: 'Edge Gateway Pro', model: 'EGP-300', brand: 'Advantech', category: 'AI Box', status: 'draft', aidaptiv: false, format: 'nonstandard' },
    { name: 'GPU Expansion Chassis', model: 'GEC-8X', brand: 'AIC', category: 'Rack Server', status: 'published', aidaptiv: false, format: 'nonstandard' },
].map((item, index) => ({
    id: `hw${index + 4}`,
    is_mock: true,
    product_type: 'hardware',
    product_format: item.format,
    vendor_id: 'v-phison',
    vendor_name: 'Phison Electronics',
    name: item.name,
    model: item.model,
    brand: item.brand,
    sub_category: item.category,
    display_order: index + 4,
    short_description: `Mock ${item.category} product for catalog workflow testing.`,
    status: item.status,
    created_at: `2026-04-${String(index + 1).padStart(2, '0')}`,
    updated_at: `2026-06-${String(index + 10).padStart(2, '0')}`,
    is_aidaptiv: item.aidaptiv,
    ns_platforms: item.format === 'nonstandard' ? ['NVIDIA accelerated computing platform'] : [],
    key_specifications: item.format === 'nonstandard'
        ? ['Configurable GPU topology', 'Enterprise NVMe storage']
        : ['Intel Xeon or Core Ultra processor', 'NVIDIA RTX professional GPU', 'DDR5 ECC memory', 'High-speed NVMe storage'],
    bestFor: ['AI Inference', 'Model Development', 'Enterprise Deployment'],
    history: index === 0 ? Array.from({ length: 7 }, (_, historyIndex) => ({
        action: historyIndex === 0 ? 'Published' : 'Updated',
        detail: historyIndex === 0 ? 'Listed on storefront' : `Mock revision ${7 - historyIndex}`,
        timestamp: `2026-06-${String(20 - historyIndex).padStart(2, '0')}T09:00:00.000Z`,
        user: 'System Root',
    })) : [],
}));

const MOCK_SOFTWARE_PRODUCTS = [
    { name: 'FraudShield AI', vendor: 'TPIsoftware Corporation', vendorId: 'v-tpi', category: 'Fraud Prevention', status: 'published', packaging: 'included', license: 'First year free' },
    { name: 'HealthAssist Copilot', vendor: 'TPIsoftware Corporation', vendorId: 'v-tpi', category: 'Healthcare', status: 'draft', packaging: 'optional', license: '60-day free trial' },
    { name: 'RetailPulse Analytics', vendor: 'KDAN', vendorId: 'v-kdan', category: 'Marketing', status: 'published', packaging: 'optional', license: 'Free during POC' },
    { name: 'Factory Operations Copilot', vendor: 'TPIsoftware Corporation', vendorId: 'v-tpi', category: 'Business Applications', status: 'archived', packaging: 'optional', license: '1095-day free trial' },
    { name: 'GovKnowledge Hub', vendor: 'TPIsoftware Corporation', vendorId: 'v-tpi', category: 'National Defense', status: 'published', packaging: 'included', license: 'First year free' },
    { name: 'SecureVision Monitor', vendor: 'KDAN', vendorId: 'v-kdan', category: 'Cybersecurity', status: 'draft', packaging: 'optional', license: 'Free during POC' },
].map((item, index) => ({
    id: `sw${index + 7}`,
    is_mock: true,
    product_type: 'software',
    vendor_id: item.vendorId,
    vendor_name: item.vendor,
    name: item.name,
    sub_category: item.category,
    categories: [item.category],
    display_order: index + 7,
    short_description: `Mock ${item.category} solution for product catalog testing.`,
    status: item.status,
    created_at: `2026-04-${String(index + 10).padStart(2, '0')}`,
    updated_at: `2026-06-${String(index + 18).padStart(2, '0')}`,
    tagline: `${item.name} for secure and efficient enterprise operations.`,
    // Fictional products share one unbranded stand-in; real products carry
    // their own logo from aisoportal.com.
    icon_name: 'placeholder-mock.svg', icon_data: 'images/product-icons/placeholder-mock.svg',
    license_offer: item.license,
    sw_category: item.packaging,
    compatible_hardware: item.status === 'published' ? ['hw1', 'hw2'] : [],
    features: [
        'Configurable enterprise workflow',
        'Role-based access and audit trail',
        'Real-time operational dashboard',
        'API-ready system integration',
    ],
    industries: ['Banking & Finance', 'Information Technology', 'Manufacturing'],
    officialUrl: 'https://www.tpisoftware.com',
    videoUrl: '',
    history: [],
}));

PRODUCTS.push(...MOCK_HARDWARE_PRODUCTS, ...MOCK_SOFTWARE_PRODUCTS);

// Every seeded mock product starts with a Created record. Keep the entry as
// the oldest history item so newer mock revisions remain first in the timeline.
PRODUCTS.forEach(product => {
    if (!product.history) product.history = [];
    if (!product.history.some(entry => entry.action === 'Created')) {
        product.history.push({
            action: 'Created',
            detail: 'New draft created',
            timestamp: `${product.created_at}T09:00:00.000Z`,
            user: 'System Root',
        });
    }
});

const SEED_PRODUCT_CREATED_LOGS = PRODUCTS
    .map(product => ({
        action: 'Created',
        productName: product.name,
        detail: 'New draft created',
        timestamp: `${product.created_at}T09:00:00.000Z`,
        user: 'System Root',
        pid: product.id,
        is_mock: true,
    }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

// ═══════════════════════════════════════════════════════════════════
// NAV CONFIG — per role
// ═══════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
    { key: 'sw-products', icon: 'ph-app-window', label: 'Software Products' },
    { key: 'hw-products', icon: 'ph-hard-drives', label: 'Hardware Products' },
    { key: 'compatibility', icon: 'ph-arrows-left-right', label: 'Compatibility', permission: 'compatibility.read' },
    { key: 'param-center', icon: 'ph-sliders', label: 'Parameter Center' },
    { key: 'activity-log', icon: 'ph-clock-counter-clockwise', label: 'Activity Log' },
    { key: 'settings', icon: 'ph-gear', label: 'Settings' },
];

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let currentUser = null;
let currentView = null;

let HARDWARE_PRODUCT_TYPES = [
    { label: 'miniPC', is_active: true },
    { label: 'AITPC', is_active: true },
    { label: 'AITNB', is_active: true },
    { label: 'AI Box', is_active: true },
    { label: 'Workstation', is_active: true },
    { label: 'Rack Server', is_active: true },
];
let SOFTWARE_CATEGORY_OPTIONS = [
    { label: 'Business Applications', is_active: true },
    { label: 'Cybersecurity', is_active: true },
    { label: 'ESG', is_active: true },
    { label: 'Financial Services', is_active: true },
    { label: 'Fraud Prevention', is_active: true },
    { label: 'Healthcare', is_active: true },
    { label: 'Marketing', is_active: true },
    { label: 'National Defense', is_active: true },
];
let SOFTWARE_INDUSTRY_OPTIONS = [
    { label: 'IoT', is_active: true },
    { label: 'Banking & Finance', is_active: true },
    { label: 'Healthcare', is_active: true },
    { label: 'E-commerce & Retail', is_active: true },
    { label: 'Information Technology', is_active: true },
    { label: 'Manufacturing', is_active: true },
    { label: 'Government & Public Sector', is_active: true },
    { label: 'Logistics & Transportation', is_active: true },
    { label: 'Education', is_active: true },
    { label: 'Legal & Consulting', is_active: true },
];
// Earlier seed data stored abbreviated industry labels ('IT', 'Government')
// that are not in SOFTWARE_INDUSTRY_OPTIONS, so the same industry appeared
// twice: abbreviated on the product, spelled out in the option list. Saves
// written before that fix are normalized on load (see Store.load).
const LEGACY_INDUSTRY_ALIASES = {
    'IT': 'Information Technology',
    'Government': 'Government & Public Sector',
    'Finance': 'Banking & Finance',
    'Logistics': 'Logistics & Transportation',
    'Legal': 'Legal & Consulting',
};
function normalizeIndustryLabels(labels) {
    const seen = new Set();
    return (labels || []).reduce((out, label) => {
        const canonical = LEGACY_INDUSTRY_ALIASES[label] || label;
        if (!seen.has(canonical)) { seen.add(canonical); out.push(canonical); }
        return out;
    }, []);
}
// Licensing offers are static (SW_LICENSE_TYPES in app.js), no longer a
// Parameter Center-managed list. Products store the label in `license_offer`.
const HW_KEY_SPEC_MAX_ITEMS = 8;
const HW_KEY_SPEC_MIN_ITEMS = 3;
const HW_KEY_SPEC_MAX_CHARS = 150;
const SOFTWARE_FEATURE_MAX_ITEMS = 5;
const SOFTWARE_FEATURE_MAX_CHARS = 150;
// UI copy uses decimal MB; keep the client limit aligned with typical API/proxy limits.
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1000 * 1000;
const PRODUCT_IMAGE_MAX_COUNT = 5;
const PRODUCT_IMAGE_VALIDATION_MESSAGES = Object.freeze({
    required: 'Please upload Product Image.',
    file: 'File exceeds the 5MB size limit or the format is invalid. Only JPG, JPEG, and PNG files are supported.',
    count: `You can upload up to ${PRODUCT_IMAGE_MAX_COUNT} images.`,
});

// ── Shared empty-state copy (used by every list via emptyState()) ──
const EMPTY_STATE_NO_DATA = 'No matching data found.';
const EMPTY_STATE_NO_RESULTS = 'No results found. Please try adjusting your search criteria.';

// ── Standard HTTP error-screen copy (for future API wiring; previewable in Settings) ──
const HTTP_ERROR_MESSAGES = {
    400: 'Invalid request.',
    401: 'Authentication required.',
    403: "Permission denied. Please contact your organization's administrator.",
    404: 'The requested data was not found or has been deleted.',
    500: 'Unable to retrieve data. Please try again later.',
    503: 'Service temporarily unavailable. Please try again later.',
};
let createProductState = { type: null, hardwareImage: null, softwareIcon: null, softwareImages: [] };

let sortState = { software: { key: null, dir: 'asc' }, hardware: { key: null, dir: 'asc' } };
let ACTIVITY_LOG = SEED_PRODUCT_CREATED_LOGS.map(log => ({ ...log }));
