// ═══════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════

const DEMO_LOGIN = { email: 'root@aiso.com', password: 'aiso1234' };

// ── Organization Management (docs/ORG_MANAGEMENT_PLAN.md) ──
// Three tables replace the old embedded ORGS[].members, because one account
// can belong to several organizations:  USERS ──< ROLE_BINDINGS >── ROLES ── ORGS.
// Permissions live on roles only; an account carries none of its own.

const ORG_TYPES = ['OPERATOR', 'VENDOR', 'CUSTOMER'];
const VENDOR_TYPES = ['SOFTWARE', 'HARDWARE', 'SI'];
// A customer is either one person or a company. The split is real, not a
// label: an individual customer IS the account, so it has no members or
// roles to manage — see CUSTOMER_TYPE_CAPABILITIES.
const CUSTOMER_TYPES = ['INDIVIDUAL', 'ENTERPRISE'];
// This round builds operator and customer orgs only. Vendor orgs stay as data
// (getMatchingVendorId still reads them) but cannot be managed, hold roles or
// sign in until VENDOR is added here.
const ENABLED_ORG_TYPES = ['OPERATOR', 'CUSTOMER'];

const PERMISSION_MODULES = [
    { key: 'sw_product',    label: 'Software Products' },
    { key: 'hw_product',    label: 'Hardware Products' },
    { key: 'compatibility', label: 'Compatibility' },
    { key: 'parameter',     label: 'Parameter Center' },
    { key: 'order',         label: 'Orders' },
    { key: 'ticket',        label: 'Service Desk' },
    { key: 'asset',         label: 'Asset Registry' },
    { key: 'organization',  label: 'Organizations' },
    { key: 'activity_log',  label: 'Activity Log' },
];
const PERMISSION_ACTIONS = ['c', 'r', 'u', 'd'];

// Layer 1 — the ceiling per org type: the most a role in that org may be
// granted. Roles are user-built, so without this a customer admin could grant
// their own role Parameter Center access. Cells outside it are disabled in the
// role editor and stripped on save. Customer grants apply to their own data
// only; the scoping lives with each module, not here.
const ORG_TYPE_CAPABILITIES = {
    OPERATOR: {
        sw_product: 'crud', hw_product: 'crud', compatibility: 'cru', parameter: 'crud',
        order: 'crud', ticket: 'cru', asset: 'crud', organization: 'crud', activity_log: 'r',
    },
    // CUSTOMER resolves through CUSTOMER_TYPE_CAPABILITIES below.
    VENDOR: {}, // deferred — see the plan's Deferred section
};

// Enterprise customers run their own members and roles; an individual customer
// is a single person, so nothing about organization management applies.
const CUSTOMER_TYPE_CAPABILITIES = {
    ENTERPRISE: {
        order: 'r', ticket: 'cru', asset: 'ru', organization: 'crud', activity_log: 'r',
    },
    INDIVIDUAL: {
        order: 'r', ticket: 'cru', asset: 'ru', activity_log: 'r',
    },
};

let ORGS = [
    { id: 'v-aiso', customer_type: null, name: 'AISO', types: ['OPERATOR', 'VENDOR'], vendor_type: 'HARDWARE', status: 'active',
      contact_email: 'service.desk@aiso.com', note: '', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' },
    { id: 'v-phison', customer_type: null, name: 'Phison Electronics', types: ['VENDOR'], vendor_type: 'HARDWARE', status: 'active',
      contact_email: '', note: '', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' },
    { id: 'v-tpi', customer_type: null, name: 'TPIsoftware Corporation', types: ['VENDOR'], vendor_type: 'SOFTWARE', status: 'active',
      contact_email: '', note: '', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' },
    { id: 'v-kdan', customer_type: null, name: 'KDAN', types: ['VENDOR'], vendor_type: 'SOFTWARE', status: 'active',
      contact_email: '', note: '', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' },
    { id: 'c-megabank', name: 'MegaBank Corp', types: ['CUSTOMER'], vendor_type: null, customer_type: 'ENTERPRISE', status: 'active',
      contact_email: 'tom@megabank.com', note: '', created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'c-govcloud', name: 'GovCloud Agency', types: ['CUSTOMER'], vendor_type: null, customer_type: 'ENTERPRISE', status: 'active',
      contact_email: 'robert@govcloud.gov', note: '', created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    // One person who bought directly: no members, no roles to manage.
    { id: 'c-weiting', name: 'Wei-Ting Chen', types: ['CUSTOMER'], vendor_type: null, customer_type: 'INDIVIDUAL', status: 'active',
      contact_email: 'weiting.chen@gmail.com', note: 'Direct purchase, single seat.', created_at: '2026-05-04T00:00:00.000Z', updated_at: '2026-05-04T00:00:00.000Z' },
];

let USERS = [
    // The Super Admin is a system account: no membership, no organization.
    { id: 'u-root', name: 'System Root', email: 'root@aiso.com', status: 'active', is_super_admin: true,
      created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' },
    { id: 'u-tom', name: 'Tom Baker', email: 'tom@megabank.com', status: 'active', is_super_admin: false,
      created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'u-amy', name: 'Amy Zhang', email: 'amy@megabank.com', status: 'active', is_super_admin: false,
      created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'u-robert', name: 'Robert Kim', email: 'robert@govcloud.gov', status: 'active', is_super_admin: false,
      created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'u-weiting', name: 'Wei-Ting Chen', email: 'weiting.chen@gmail.com', status: 'active', is_super_admin: false,
      created_at: '2026-05-04T00:00:00.000Z', updated_at: '2026-05-04T00:00:00.000Z' },
    // Two AISO desk colleagues, so internal notes and confirmations can be
    // tried by switching View as between them.
    { id: 'u-aiso-kevin', name: 'Kevin Lin', email: 'kevin.lin@aiso.com', status: 'active', is_super_admin: false,
      created_at: '2026-09-29T00:00:00.000Z', updated_at: '2026-09-29T00:00:00.000Z' },
    { id: 'u-aiso-ivy', name: 'Ivy Chen', email: 'ivy.chen@aiso.com', status: 'active', is_super_admin: false,
      created_at: '2026-09-29T00:00:00.000Z', updated_at: '2026-09-29T00:00:00.000Z' },
];

// AISO seeds one desk role for the two demo colleagues; any other operator
// role is built in the UI. The customer Admin / Member pair replaces the old
// OA / CM org_role values.
const CUSTOMER_ADMIN_PERMISSIONS = ['order.r', 'ticket.c', 'ticket.r', 'ticket.u', 'asset.r', 'asset.u',
    'organization.c', 'organization.r', 'organization.u', 'organization.d', 'activity_log.r'];
const CUSTOMER_MEMBER_PERMISSIONS = ['order.r', 'ticket.c', 'ticket.r', 'ticket.u', 'asset.r'];

let ROLES = [
    { id: 'r-aiso-desk', org_id: 'v-aiso', name: 'Service Desk', description: 'Works the Service Desk: replies, internal notes, handling.',
      permissions: ['order.r', 'ticket.c', 'ticket.r', 'ticket.u', 'asset.r', 'activity_log.r'],
      created_at: '2026-09-29T00:00:00.000Z', updated_at: '2026-09-29T00:00:00.000Z' },
    { id: 'r-mb-admin', org_id: 'c-megabank', name: 'Admin', description: 'Manages MegaBank members and roles.',
      permissions: [...CUSTOMER_ADMIN_PERMISSIONS], created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'r-mb-member', org_id: 'c-megabank', name: 'Member', description: 'Reads orders and raises tickets.',
      permissions: [...CUSTOMER_MEMBER_PERMISSIONS], created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'r-gc-admin', org_id: 'c-govcloud', name: 'Admin', description: 'Manages GovCloud members and roles.',
      permissions: [...CUSTOMER_ADMIN_PERMISSIONS], created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    { id: 'r-gc-member', org_id: 'c-govcloud', name: 'Member', description: 'Reads orders and raises tickets.',
      permissions: [...CUSTOMER_MEMBER_PERMISSIONS], created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z' },
    // An individual customer gets exactly one role, created with the org.
    { id: 'r-wt-owner', org_id: 'c-weiting', name: 'Owner', description: 'The individual customer themselves.',
      permissions: [...CUSTOMER_MEMBER_PERMISSIONS], created_at: '2026-05-04T00:00:00.000Z', updated_at: '2026-05-04T00:00:00.000Z' },
];

// One row per account × role. Robert holds roles in two organizations to demo
// the one-to-many binding and the role switcher.
let ROLE_BINDINGS = [
    { id: 'rb-0001', user_id: 'u-tom',    role_id: 'r-mb-admin',  status: 'active', created_at: '2025-06-01T00:00:00.000Z' },
    { id: 'rb-0002', user_id: 'u-amy',    role_id: 'r-mb-member', status: 'active', created_at: '2025-06-01T00:00:00.000Z' },
    { id: 'rb-0003', user_id: 'u-robert', role_id: 'r-gc-admin',  status: 'active', created_at: '2025-06-01T00:00:00.000Z' },
    { id: 'rb-0004', user_id: 'u-robert', role_id: 'r-mb-member', status: 'active', created_at: '2025-06-01T00:00:00.000Z' },
    { id: 'rb-0005', user_id: 'u-weiting', role_id: 'r-wt-owner', status: 'active', created_at: '2026-05-04T00:00:00.000Z' },
    { id: 'rb-aiso-kevin', user_id: 'u-aiso-kevin', role_id: 'r-aiso-desk', status: 'active', created_at: '2026-09-29T00:00:00.000Z' },
    { id: 'rb-aiso-ivy',   user_id: 'u-aiso-ivy',   role_id: 'r-aiso-desk', status: 'active', created_at: '2026-09-29T00:00:00.000Z' },
];

// Kept aside before a save replaces the arrays, so store.js can add the desk
// colleagues to saves written before they were seeded.
const SEED_AISO_DESK = {
    roles: ROLES.filter(r => r.id === 'r-aiso-desk'),
    users: USERS.filter(u => u.id === 'u-aiso-kevin' || u.id === 'u-aiso-ivy'),
    bindings: ROLE_BINDINGS.filter(b => b.role_id === 'r-aiso-desk'),
};

let PRODUCTS = [
    // === HARDWARE ===
    // AISO's own-brand hardware. Only own-brand devices get an entry in the asset
    // registry, because AISO warrants only what it builds -- partner hardware is
    // warranted by its own vendor.
    {
        id: 'hw-aiso1', product_type: 'hardware', product_format: 'standard', is_own_brand: true,
        vendor_id: 'v-aiso', vendor_name: 'AISO',
        name: 'AISO1 AI Agent Workstation', model: 'AISO1', brand: 'AISO', sub_category: 'Workstation', display_order: 0,
        short_description: 'Compact AI workstation for enterprise AI labs and personal AI studios.',
        status: 'published', created_at: '2026-02-01', updated_at: '2026-03-14',
        is_aidaptiv: true,
        key_specifications: [
            'AMD Ryzen AI Max+ 395 (16 Core / 32 Thread)',
            'AMD Radeon 8060S Graphics',
            'LPDDR5X 128GB',
            'HDMI x 1',
            '180 x 180 x 80 mm',
            'Ubuntu 24.04',
        ],
        bestFor: ['AI Platform', 'AI Agent', 'Data Science'],
    },
    {
        id: 'hw1', product_type: 'hardware', product_format: 'standard', is_own_brand: false, vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
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
        id: 'hw2', product_type: 'hardware', product_format: 'standard', is_own_brand: false, vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
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
        id: 'hw3', product_type: 'hardware', product_format: 'standard', is_own_brand: false, vendor_id: 'v-phison', vendor_name: 'Phison Electronics',
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

// ═══════════════════════════════════════════════════════════════════
// ASSET REGISTRY
// One row per AISO-built device. Serial numbers are produced by the
// manufacturing team and arrive as CSV; this prototype seeds a few so the
// views have something to show.
//
// Two owners share this record and a re-import must respect the split:
//   manufacturing  serial_no · product_id · shipped_at · warranty_months
//   workspace      warranty_* overrides · service_org_id · claimed_at
//                  · order_line_id · status · replaced_by_asset_id
// warranty_source is the test for whether the dates may be overwritten: once
// it is anything other than 'ship_date', someone has set them deliberately.
// ═══════════════════════════════════════════════════════════════════

const WARRANTY_SOURCES = ['ship_date', 'invoice', 'manual'];
const ASSET_STATUSES = ['ACTIVE', 'DECOMMISSIONED'];
// A device is "expiring soon" this many days before its warranty ends.
const ASSET_EXPIRING_SOON_DAYS = 90;

let ASSETS = [
    {
        id: 'ast-0001', serial_no: 'AISO1-2026-1001', product_id: 'hw-aiso1',
        shipped_at: '2026-03-14', warranty_months: 36,
        warranty_start: '2026-03-14', warranty_end: '2029-03-13', warranty_source: 'ship_date',
        service_org_id: null, claimed_at: null, order_line_id: null,
        status: 'ACTIVE', replaced_by_asset_id: null,
        created_at: '2026-03-14', updated_at: '2026-03-14',
    },
    {
        id: 'ast-0002', serial_no: 'AISO1-2026-1002', product_id: 'hw-aiso1',
        shipped_at: '2026-01-20', warranty_months: 36,
        warranty_start: '2026-02-02', warranty_end: '2029-02-01', warranty_source: 'invoice',
        service_org_id: 'c-megabank', claimed_at: '2026-02-10', order_line_id: null,
        status: 'ACTIVE', replaced_by_asset_id: null,
        created_at: '2026-01-20', updated_at: '2026-02-10',
    },
    {
        id: 'ast-0003', serial_no: 'AISO1-2026-1003', product_id: 'hw-aiso1',
        shipped_at: '2026-06-01', warranty_months: 12,
        warranty_start: '2026-06-01', warranty_end: '2027-05-31', warranty_source: 'ship_date',
        service_org_id: null, claimed_at: null, order_line_id: null,
        status: 'ACTIVE', replaced_by_asset_id: null,
        created_at: '2026-06-01', updated_at: '2026-06-01',
    },
    {
        id: 'ast-0004', serial_no: 'AISO1-2025-0007', product_id: 'hw-aiso1',
        shipped_at: '2025-09-10', warranty_months: 12,
        warranty_start: '2025-09-10', warranty_end: '2026-09-09', warranty_source: 'ship_date',
        service_org_id: 'c-govcloud', claimed_at: '2025-09-22', order_line_id: null,
        status: 'ACTIVE', replaced_by_asset_id: null,
        created_at: '2025-09-10', updated_at: '2025-09-22',
    },
    {
        id: 'ast-0005', serial_no: 'AISO1-2024-0100', product_id: 'hw-aiso1',
        shipped_at: '2024-05-02', warranty_months: 12,
        warranty_start: '2024-05-02', warranty_end: '2025-05-01', warranty_source: 'ship_date',
        service_org_id: 'c-megabank', claimed_at: '2024-05-20', order_line_id: null,
        status: 'ACTIVE', replaced_by_asset_id: null,
        created_at: '2024-05-02', updated_at: '2024-05-20',
    },
];

// ═══════════════════════════════════════════════════════════════════
// ORDERS — purchase orders from customers.
// Supplier and customer are free-text names (the vendor_name pattern):
// the *_org_id columns stay null until Organization Management ships,
// then get backfilled by name matching. HW and SW suppliers are separate
// header fields because one order often mixes both from different vendors.
// The system integrator (SI) is a third, optional party: the company that
// delivers and installs on site, which is often neither supplier.
// ═══════════════════════════════════════════════════════════════════

let ORDERS = [
    {
        id: 'ord-0001',
        order_no: 'PO-2026-0001',
        contract_no: 'CTR-2026-0001',
        customer_name: 'MegaBank Corp', customer_org_id: null,
        hw_supplier_name: 'Phison Electronics', hw_supplier_org_id: null,
        sw_supplier_name: 'TPIsoftware Corporation', sw_supplier_org_id: null,
        si_name: 'Systex Corporation', si_org_id: null,
        sales_contact: 'Ivy Chen',
        order_date: '2026-07-30',
        status: 'CONFIRMED', // DRAFT | CONFIRMED | CANCELLED
        notes: '',
        attachments: [{ id: 'att-seed-ord-0001', name: 'PO-2026-0001-signed.txt', type: 'text/plain', size: 42, is_image: false, doc_type: 'PO',
            data_url: 'data:text/plain;base64,UE8tMjAyNi0wMDAxIC0gc2lnbmVkIHB1cmNoYXNlIG9yZGVyIChkZW1vKQ==' }],
        created_at: '2026-07-30T09:00:00.000Z', updated_at: '2026-08-02T10:00:00.000Z',
    },
    {
        id: 'ord-0002',
        order_no: 'PO-2026-0002',
        contract_no: '',
        customer_name: 'GovCloud Agency', customer_org_id: null,
        hw_supplier_name: 'Phison Electronics', hw_supplier_org_id: null,
        sw_supplier_name: '', sw_supplier_org_id: null,
        si_name: '', si_org_id: null,
        sales_contact: '',
        order_date: '2026-08-15',
        status: 'DRAFT',
        notes: 'Awaiting final GPU allocation.',
        attachments: [],
        created_at: '2026-08-15T09:00:00.000Z', updated_at: '2026-08-15T09:00:00.000Z',
    },
    {
        id: 'ord-0003',
        order_no: 'PO-2025-0031',
        contract_no: 'CTR-2025-0031',
        customer_name: 'GovCloud Agency', customer_org_id: null,
        hw_supplier_name: 'AISO', hw_supplier_org_id: null,
        sw_supplier_name: '', sw_supplier_org_id: null,
        si_name: '', si_org_id: null,
        sales_contact: 'Ivy Chen',
        order_date: '2025-09-01',
        status: 'CONFIRMED',
        notes: '',
        attachments: [],
        created_at: '2025-09-01T09:00:00.000Z', updated_at: '2025-09-10T10:00:00.000Z',
    },
    {
        id: 'ord-0004', order_no: 'PO-2026-0004', contract_no: '',
        customer_name: 'Wei-Ting Chen', customer_org_id: null,
        hw_supplier_name: '', hw_supplier_org_id: null,
        sw_supplier_name: 'TPIsoftware Corporation', sw_supplier_org_id: null,
        si_name: '', si_org_id: null,
        sales_contact: 'Ivy Chen',
        order_date: '2026-05-04',
        status: 'CONFIRMED',
        notes: 'Single-seat purchase by an individual customer.',
        attachments: [],
        created_at: '2026-05-04T09:00:00.000Z', updated_at: '2026-05-04T09:00:00.000Z',
    },
];

// Per-line service level, matching the reference prototype's plan list.
const ORDER_SLA_PLAN_OPTIONS = ['5x8', '7x24', 'On-site'];

// One serial per unit: serial_nos.length tracks qty, and a CONFIRMED order
// requires every HW serial filled in. The BOM applies to every unit in the
// line — a different configuration is a separate line.
// A SW line with parent_line_id is bundled with that HW line; each license
// key binds to one of its units by index (unit: null = all units), so the
// binding survives serials that are still blank or get corrected later.
let ORDER_LINES = [
    {
        id: 'ol-0001', order_id: 'ord-0001', line_no: 1, scope: 'HW',
        product_id: 'hw1', product_name: 'GIGABYTE Workstation', qty: 2, sla_plan: '7x24',
        warranty_months: 36, warranty_start: '2026-08-05', warranty_end: '2029-08-04',
        license_keys: [], version: '', license_start: '', license_end: '',
        serial_nos: ['GBT-2026-0771', 'GBT-2026-0772'],
        bom: [
            { component_type: 'CPU', brand: 'Intel', model: 'Xeon 60 Core', qty: 1 },
            { component_type: 'GPU', brand: 'NVIDIA', model: 'Pro6000 Blackwell Max-Q 96GB', qty: 2 },
            { component_type: 'Memory', brand: 'Micron', model: 'DDR5-5600 64GB DIMM', qty: 8 },
            { component_type: 'Storage', brand: 'Phison', model: 'X200 NVMe 7680GB', qty: 2 },
        ],
        notes: '',
    },
    {
        id: 'ol-0002', order_id: 'ord-0001', line_no: 2, scope: 'SW',
        parent_line_id: 'ol-0001', supplier_name: '',
        product_id: 'sw1', product_name: 'digiRunner', qty: 2, sla_plan: '5x8',
        serial_nos: [], bom: [],
        license_keys: [
            { key: 'DGRN-4A7K-92MF-XT01', unit: 0 },
            { key: 'DGRN-4A7K-92MF-XT02', unit: 1 },
        ], version: '3.8.2',
        license_start: '2026-08-01', license_end: '2027-07-31',
        notes: '',
    },
    {
        id: 'ol-0003', order_id: 'ord-0002', line_no: 1, scope: 'HW',
        product_id: 'hw2', product_name: 'Gigacomputing 4U Server (4x GPU)', qty: 1, sla_plan: '',
        warranty_months: null, warranty_start: '', warranty_end: '',
        serial_nos: [''],
        bom: [
            { component_type: 'GPU', brand: 'NVIDIA', model: 'Pro6000 Blackwell 96GB', qty: 4 },
        ],
        notes: '',
    },
    {
        id: 'ol-0004', order_id: 'ord-0003', line_no: 1, scope: 'HW',
        product_id: 'hw-aiso1', product_name: 'AISO1 AI Agent Workstation', qty: 1, sla_plan: '5x8',
        warranty_months: 12, warranty_start: '2025-09-10', warranty_end: '2026-09-09',
        license_keys: [], version: '', license_start: '', license_end: '',
        serial_nos: ['AISO1-2025-0442'],
        bom: [
            { component_type: 'GPU', brand: 'NVIDIA', model: 'RTX 6000 Ada 48GB', qty: 1 },
            { component_type: 'Storage', brand: 'Phison', model: 'X200 NVMe 3840GB', qty: 1 },
        ],
        notes: '',
    },
    {
        id: 'ol-0005', order_id: 'ord-0004', line_no: 1, scope: 'SW',
        product_id: null, product_name: 'digiRunner Lite', qty: 1, sla_plan: '5x8',
        warranty_months: null, warranty_start: '', warranty_end: '',
        parent_line_id: null, supplier_name: '',
        license_keys: [{ key: 'DGRL-7722-QW18-MK04', unit: null }], version: '3.8.2', license_start: '2026-05-04', license_end: '2027-05-03',
        serial_nos: [],
        bom: [],
        notes: '',
    },
];

// ═══════════════════════════════════════════════════════════════════
// TICKETS — after-sales requests. AISO is the single service window, so
// there is no vendor assignment. A ticket is anchored to one order line
// (and, for hardware, one serial). Everything the desk needs to read the
// ticket is copied into `snapshot` at creation, so editing or cancelling
// the order later never rewrites history and rendering needs no join.
// ═══════════════════════════════════════════════════════════════════

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER_INFO', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const TICKET_CATEGORIES = ['Hardware Failure', 'Software / Model Anomaly', 'License / Activation', 'Other'];
const TICKET_CHANNELS = ['Email', 'Phone', 'Workspace', 'On-site'];
// Who the desk is waiting on while a ticket sits In progress. Desk-only:
// the customer keeps seeing the public status, because AISO stays the single
// window and which supplier is holding things up is not their business.
const TICKET_INTERNAL_STATES = ['NONE', 'HW_SUPPLIER', 'SW_SUPPLIER', 'SI', 'AISO_INTERNAL'];
const TICKET_INTERNAL_STATE_LABEL = {
    NONE: 'With the desk',
    HW_SUPPLIER: 'With HW supplier',
    SW_SUPPLIER: 'With SW supplier',
    SI: 'With system integrator',
    AISO_INTERNAL: 'AISO internal work',
};
// Hours AISO has to post its first reply, by the line's SLA plan.
const TICKET_FIRST_RESPONSE_HOURS = { '7x24': 4, 'On-site': 8, '5x8': 24 };
const TICKET_FIRST_RESPONSE_DEFAULT_HOURS = 24;

let TICKETS = [
    {
        id: 'tk-0001', ticket_no: 'TK-0001',
        customer_name: 'MegaBank Corp', customer_org_id: null,
        order_id: 'ord-0001', order_line_id: 'ol-0001', serial_no: 'GBT-2026-0771', scope: 'HW',
        subject: 'GPU node fails POST after firmware update',
        description: 'After applying BIOS F12 the node stops at POST code 94. The second unit on the same order is fine.',
        category: 'Hardware Failure', priority: 'HIGH', status: 'IN_PROGRESS',
        internal_state: 'HW_SUPPLIER', internal_party: 'Phison Electronics',
        internal_since: '2026-08-21T02:10:00.000Z', internal_note: 'RMA raised, waiting on their diagnosis.',
        channel: 'Email', reported_by: 'Amy Zhang · amy@megabank.com',
        snapshot: { order_no: 'PO-2026-0001', line_no: 1, product_name: 'GIGABYTE Workstation', sla_plan: '7x24',
                    coverage_kind: 'warranty', coverage_end: '2029-08-04', supplier_name: 'Phison Electronics', si_name: 'Systex Corporation', license_key: '' },
        created_at: '2026-09-05T01:12:00.000Z', updated_at: '2026-09-06T06:30:00.000Z',
        first_response_at: '2026-09-05T02:40:00.000Z', resolved_at: null,
    },
    {
        id: 'tk-0002', ticket_no: 'TK-0002',
        customer_name: 'MegaBank Corp', customer_org_id: null,
        order_id: 'ord-0001', order_line_id: 'ol-0002', serial_no: '', scope: 'SW',
        subject: 'digiRunner license activation error 0x41',
        description: 'Activation fails with error 0x41 on the second node after the cluster was re-imaged.',
        category: 'License / Activation', priority: 'MEDIUM', status: 'AWAITING_CUSTOMER_INFO',
        channel: 'Workspace', reported_by: 'Tom Baker · tom@megabank.com',
        snapshot: { order_no: 'PO-2026-0001', line_no: 2, product_name: 'digiRunner', sla_plan: '5x8',
                    coverage_kind: 'license', coverage_end: '2027-07-31', supplier_name: 'TPIsoftware Corporation', si_name: 'Systex Corporation', license_key: 'DGRN-4A7K-92MF-XT01' },
        created_at: '2026-09-04T03:20:00.000Z', updated_at: '2026-09-07T01:05:00.000Z',
        first_response_at: '2026-09-04T05:10:00.000Z', resolved_at: null,
    },
    {
        id: 'tk-0003', ticket_no: 'TK-0003',
        customer_name: 'MegaBank Corp', customer_org_id: null,
        order_id: 'ord-0001', order_line_id: 'ol-0001', serial_no: 'GBT-2026-0772', scope: 'HW',
        subject: 'Fan noise on unit 2 under sustained load',
        description: 'Audible fan surge every few minutes when all GPUs are busy. No thermal throttling observed.',
        category: 'Hardware Failure', priority: 'LOW', status: 'OPEN',
        channel: 'Phone', reported_by: 'Amy Zhang · amy@megabank.com',
        snapshot: { order_no: 'PO-2026-0001', line_no: 1, product_name: 'GIGABYTE Workstation', sla_plan: '7x24',
                    coverage_kind: 'warranty', coverage_end: '2029-08-04', supplier_name: 'Phison Electronics', si_name: 'Systex Corporation', license_key: '',
                    licenses: [{ product_name: 'digiRunner v3.8.2', license_key: 'DGRN-4A7K-92MF-XT02', all_units: false, license_end: '2027-07-31' }] },
        created_at: '2026-09-07T08:00:00.000Z', updated_at: '2026-09-07T08:00:00.000Z',
        first_response_at: null, resolved_at: null,
    },
    {
        id: 'tk-0004', ticket_no: 'TK-0004',
        customer_name: 'GovCloud Agency', customer_org_id: null,
        order_id: 'ord-0003', order_line_id: 'ol-0004', serial_no: 'AISO1-2025-0442', scope: 'HW',
        subject: 'Request on-site check before warranty expiry',
        description: 'Warranty ends 2026-09-09. Please schedule a health check and confirm extension options.',
        category: 'Other', priority: 'MEDIUM', status: 'RESOLVED',
        channel: 'Email', reported_by: 'Robert Kim · robert@govcloud.gov',
        snapshot: { order_no: 'PO-2025-0031', line_no: 1, product_name: 'AISO1 AI Agent Workstation', sla_plan: '5x8',
                    coverage_kind: 'warranty', coverage_end: '2026-09-09', supplier_name: 'AISO', si_name: '', license_key: '' },
        created_at: '2026-08-28T02:00:00.000Z', updated_at: '2026-09-02T07:45:00.000Z',
        first_response_at: '2026-08-28T06:30:00.000Z', resolved_at: '2026-09-02T07:45:00.000Z',
    },
];

// author_type: CUSTOMER | INTERNAL. is_internal marks a desk-only note that
// the customer never sees.
let TICKET_MESSAGES = [
    { id: 'tm-0001', ticket_id: 'tk-0001', author_type: 'CUSTOMER', author_name: 'Amy Zhang', is_internal: false, created_at: '2026-09-05T01:12:00.000Z',
      body: 'After applying BIOS F12 the node GBT-2026-0771 stops at POST code 94. Second unit on the same order is fine. Console photo attached.',
      attachments: [{ id: 'att-seed-0001', name: 'console-photo.png', type: 'image/svg+xml', size: 18240, is_image: true,
                      data_url: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='400'%3E%3Crect width='640' height='400' fill='%230b0f1a'/%3E%3Ctext x='32' y='70' font-family='Menlo,monospace' font-size='22' fill='%234ade80'%3EAISO BIOS F12  -  GIGABYTE Workstation%3C/text%3E%3Ctext x='32' y='120' font-family='Menlo,monospace' font-size='18' fill='%23e5e7eb'%3ESerial: GBT-2026-0771%3C/text%3E%3Ctext x='32' y='200' font-family='Menlo,monospace' font-size='64' fill='%23f87171'%3EPOST 94%3C/text%3E%3Ctext x='32' y='250' font-family='Menlo,monospace' font-size='18' fill='%239ca3af'%3EPCI bus enumeration halted%3C/text%3E%3Ctext x='32' y='350' font-family='Menlo,monospace' font-size='14' fill='%236b7280'%3Econsole-photo.png (seed placeholder)%3C/text%3E%3C/svg%3E" }] },
    { id: 'tm-0002', ticket_id: 'tk-0001', author_type: 'INTERNAL', author_name: 'System Root', is_internal: true, created_at: '2026-09-05T02:40:00.000Z',
      body: 'Warranty active to 2029-08-04, SLA 7x24. Priority raised to High: production node. Checking with the supplier offline.' },
    { id: 'tm-0003', ticket_id: 'tk-0001', author_type: 'INTERNAL', author_name: 'System Root', is_internal: false, created_at: '2026-09-06T06:30:00.000Z',
      body: 'Please try clearing CMOS and booting with a single DIMM in A1. If POST 94 persists we will arrange an RMA under warranty. Could you confirm the result by end of day?' },
    { id: 'tm-0004', ticket_id: 'tk-0002', author_type: 'CUSTOMER', author_name: 'Tom Baker', is_internal: false, created_at: '2026-09-04T03:20:00.000Z',
      body: 'Activation fails with error 0x41 on the second node after we re-imaged the cluster.' },
    { id: 'tm-0005', ticket_id: 'tk-0002', author_type: 'INTERNAL', author_name: 'System Root', is_internal: false, created_at: '2026-09-04T05:10:00.000Z',
      body: 'Error 0x41 means the key is bound to the previous machine fingerprint. Please send the new node ID from the About page so we can rebind the key.' },
    { id: 'tm-0006', ticket_id: 'tk-0003', author_type: 'CUSTOMER', author_name: 'Amy Zhang', is_internal: false, created_at: '2026-09-07T08:00:00.000Z',
      body: 'Audible fan surge every few minutes when all GPUs are busy. No thermal throttling observed. Logged by phone.' },
    { id: 'tm-0007', ticket_id: 'tk-0004', author_type: 'CUSTOMER', author_name: 'Robert Kim', is_internal: false, created_at: '2026-08-28T02:00:00.000Z',
      body: 'Warranty ends 2026-09-09. Please schedule a health check and confirm extension options.' },
    { id: 'tm-0008', ticket_id: 'tk-0004', author_type: 'INTERNAL', author_name: 'System Root', is_internal: false, created_at: '2026-08-28T06:30:00.000Z',
      body: 'Booked the on-site check for 2026-09-01 09:00. An extension quote will follow the visit.' },
    { id: 'tm-0009', ticket_id: 'tk-0004', author_type: 'INTERNAL', author_name: 'System Root', is_internal: false, created_at: '2026-09-02T07:45:00.000Z',
      body: 'Health check completed, no faults found. Extension quote sent to Robert by email. Marking resolved.' },
];

// In-app notifications for AISO people (docs/SERVICE_DESK_PLAN.md, 內部通知).
// { id, user_id, ticket_id, message_id, kind: 'NOTE' | 'CONFIRM' | 'CONFIRMED',
//   actor_name, created_at, read_at }. Empty in the seed: AISO has no seeded
// staff, so notifications only exist once people are added under Organizations.
let NOTIFICATIONS = [];

// Each item shows when the acting role holds its read grant (Settings is the
// user's own profile and always shows). Grants decide the nav, not a
// customer/desk flag: a customer role simply holds no product grants.
const NAV_ITEMS = [
    { key: 'sw-products', icon: 'ph-app-window', label: 'Software Products', permission: 'sw_product.r' },
    { key: 'hw-products', icon: 'ph-hard-drives', label: 'Hardware Products', permission: 'hw_product.r' },
    { key: 'orders', icon: 'ph-shopping-cart', label: 'Orders', permission: 'order.r' },
    { key: 'service-desk', icon: 'ph-headset', label: 'Service Desk', permission: 'ticket.r' },
    { key: 'organizations', icon: 'ph-buildings', label: 'Organizations', permission: 'organization.r' },
    // Asset Registry (product registration) is hidden for now: the MVP4 plan
    // builds Order Management first, then Organization Management. Restore by
    // uncommenting this entry — the view and its code are untouched.
    // { key: 'assets', icon: 'ph-barcode', label: 'Asset Registry', permission: 'asset.r' },
    { key: 'compatibility', icon: 'ph-arrows-left-right', label: 'Compatibility', permission: 'compatibility.r' },
    { key: 'param-center', icon: 'ph-sliders', label: 'Parameter Center', permission: 'parameter.r' },
    { key: 'activity-log', icon: 'ph-clock-counter-clockwise', label: 'Activity Log', permission: 'activity_log.r' },
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
