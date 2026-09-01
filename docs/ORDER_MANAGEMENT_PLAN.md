# MVP4 訂單管理模組規劃（Order Management）

**狀態**：已實作（2026-09-01，commit 系列見 git log）
**日期**：2026-09-01
**前提**：MVP4 設計順序調整 —— 產品註冊（Asset Registry）先隱藏、訂單管理先做、組織管理排在訂單管理之後。

## 參考來源

| 檔案 | 拿了什麼 |
|---|---|
| `aiso-poc/docs/CONTRACT_PO_TICKETING_V1.md` | `po_headers` / `po_lines` 欄位骨架、revision 語意、狀態機 |
| `portal-v4-mvp/README.md` | 「夥伴硬體序號放在訂單行、不進 Asset Registry」的既有決定 |
| `portal-v4-mvp/js/app.js` (`getMatchingVendorId`) | 自由輸入 + 事後對 org 的既有模式，供應商/客戶欄位照抄 |
| `portal-v4-mvp/js/seed-data.js` (assets) | 資產已預留 `order_line_id`，是未來回接訂單的掛鉤 |
| `aisoportal-clone/portal-product-org-prototype.html` | `HARDWARE_BOMS` / `HARDWARE_BOM_DETAILS` 的 BOM 結構（component/brand/model/qty）；該檔沒有序號欄位，序號規則是本規劃新加 |

## 設計原則

1. **本模組是前端 localStorage prototype**，不是 CONTRACT_PO_TICKETING_V1 的後端實作。
   該規格拿來借欄位與狀態語意，合約版本、SLA、entitlement、CSV idempotency 全部**不做**。
2. **供應商與客戶一律自由輸入（free key-in）**，與現行軟硬體模組的 `vendor_name` 同模式：
   - `supplier_name` / `customer_name` 為唯一必填的字串真相。
   - `supplier_org_id` / `customer_org_id` 欄位先建、先留 `null`。
   - 組織管理上線後，用名稱比對（同 `getMatchingVendorId`）回填 id，不需搬遷資料。
3. 產品行優先從既有已發布產品挑選（picker），挑不到的允許自由輸入品名 —— 訂單不因產品目錄不全而卡住。

## 資料模型（localStorage，v4 key 內新增兩個陣列）

```js
// ORDERS — 表頭對齊 portal-product-org-prototype 的 PURCHASE_ORDERS：
// 軟硬體供應商分成兩欄，因為實務上同一張單軟硬體常來自不同供應商。
{
  id: 'ord-0001',
  order_no: 'PO-2026-0001',        // 客戶端/來源系統單號，自由輸入
  contract_no: 'CTR-2026-0012',    // 選填
  customer_name: 'MegaBank Corp',  // free key-in（真相）
  customer_org_id: null,           // 組織管理上線後回填
  hw_supplier_name: 'GIGABYTE',    // free key-in；有 HW 行時必填
  hw_supplier_org_id: null,
  sw_supplier_name: 'TPIsoftware Corporation', // free key-in；有 SW 行時必填
  sw_supplier_org_id: null,
  sales_contact: 'Ivy Chen',       // 選填
  order_date: '2026-08-15',
  status: 'DRAFT',                 // DRAFT | CONFIRMED | CANCELLED
  notes: '',
  created_at: '', updated_at: '',
}

// ORDER_LINES
{
  id: 'ol-0001',
  order_id: 'ord-0001',
  line_no: 1,
  scope: 'HW',                     // HW | SW
  product_id: 'hw1',               // 可為 null
  product_name: 'GIGABYTE Workstation', // product_id 有值時同步快照；無值時為自由輸入
  qty: 2,
  serial_nos: ['GBT-2026-0771', 'GBT-2026-0772'],
  // 一台一個序號：陣列長度跟 qty 連動，UI 改 qty 即增減欄位。
  // DRAFT 可留空；CONFIRMED 前 HW 行必須填滿。夥伴硬體序號放這裡（README 既有決定）。
  bom: [                           // 客製化 BOM，只在 scope=HW 時有；整行每台共用同一份，
    //                                配置不同就拆行。結構沿用 portal-product-org-prototype
    //                                的 HARDWARE_BOM_DETAILS。
    { component_type: 'CPU',     brand: 'Intel',  model: 'Xeon 60 Core',                qty: 1 },
    { component_type: 'GPU',     brand: 'NVIDIA', model: 'Pro6000 Blackwell Max-Q 96GB', qty: 2 },
    { component_type: 'Memory',  brand: 'Micron', model: 'DDR5-5600 64GB DIMM',          qty: 8 },
    { component_type: 'Storage', brand: 'Phison', model: 'X200 NVMe 7680GB',             qty: 2 },
  ],
  notes: '',
}
```

**BOM 是新增能力**：現有硬體產品模組只有純文字 `key_specifications`（展示文案），
沒有結構化 BOM 輸入。BOM 掛在訂單行而非產品主檔——同一型號每張訂單的實際配置可以不同，
對應後端規格「合約管允許範圍、訂單行管實際交付配置」的語意。元件列自由增刪，
不鎖白名單（參考 prototype 的預設元件清單可當建議選項）。

狀態機刻意比後端規格簡單：`DRAFT → CONFIRMED`、`DRAFT/CONFIRMED → CANCELLED`。
revision / SUPERSEDED 機制不做——prototype 直接編輯即可，等有後端再引入。

## UI 範圍（一個 nav 項目：Orders）

1. **清單頁**：訂單號、客戶、供應商（HW/SW 各自帶 badge 顯示）、日期、行數、狀態；
   搜尋比對 order_no / customer_name / hw_supplier_name / sw_supplier_name。
2. **建立/編輯 modal**：表頭欄位 + 行項目卡片（新增/刪除行、產品 picker、qty、
   序號欄位隨 qty 連動增減、HW 行的 BOM 編輯表格）。
3. **詳情 drawer**：比照現行產品詳情的呈現方式。
4. 動作寫入既有 Activity Log。

**不做**：CSV 匯入（後端規格是 CSV-first，但 prototype 先表單；需求出現再加）、
金額/幣別計算、SLA 綁定、票務連動。

## 與其他模組的接點（順序上的依賴）

| 模組 | 關係 |
|---|---|
| 組織管理（之後做） | 上線後把 `*_name` 對回 org、回填 `*_org_id`；訂單模組不等它 |
| Asset Registry（已隱藏） | `assets.order_line_id` 已預留；註冊模組回歸時把 AISO 自建機的序號從訂單行接回資產 |
| 軟硬體產品 | 訂單行的 product picker 只列已發布產品 |

## 實作切分（預估我執行的時間）

1. Seed + store：兩個陣列、2 筆示範訂單 —— 約 10 分鐘。
2. 清單頁 + nav 項目 —— 約 20 分鐘。
3. 建立/編輯 modal（含行項目、qty↔序號連動、BOM 編輯表格）—— 約 60 分鐘，是最大塊。
4. 詳情 drawer + Activity Log 接線 —— 約 15 分鐘。

合計約 2 小時，可分 4 個 commit。
