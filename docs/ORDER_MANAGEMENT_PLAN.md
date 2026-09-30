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
  si_name: 'Systex Corporation',   // free key-in；選填。系統整合商（負責交付/安裝），2026-09-08 新增
  si_org_id: null,
  sales_contact: 'Ivy Chen',       // 選填
  order_date: '2026-08-15',
  status: 'DRAFT',                 // DRAFT | CONFIRMED | CANCELLED
  notes: '',
  attachments: [],                 // 文件上傳空間（PO 掃描、合約等），2026-09-15 新增
  // 複用 Service Desk 的附件讀取/驗證機制（js/app.js readTicketAttachments）：
  // 最多 5 檔，圖片 5MB / 其他檔案 500KB，型別限 PNG/JPG/PDF/TXT/LOG/CSV/JSON。
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
   搜尋比對 order_no / customer_name / hw_supplier_name / sw_supplier_name / si_name。
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

## License ↔ SN 綁定（2026-09-24 已實作，Steve 優化建議 1）

**需求**：硬體行可以附帶軟體授權，每把 License 能對應到具體機器；確認後還能調整 License。
**原則**：資料模型給足彈性，之後要收緊就只加驗證規則，不用改資料結構（使用者判斷未來只會加限制）。

### 資料模型

SW 行新增兩個欄位，`license_keys` 從字串陣列改成物件陣列：

```js
{
  scope: 'SW',
  parent_line_id: 'ol-0001',        // 掛在哪條 HW 行底下；null = 獨立 SW 行（不綁機器）
  supplier_name: '',                // 選填；空白時沿用表頭 sw_supplier_name（一機多家軟體）
  qty: 2,                           // 授權數 = key 列數，不跟母行台數連動
  license_keys: [
    { key: 'DGRN-4A7K-92MF-XT01', unit: 0 },    // 綁母行第 1 台（serial_nos[0]）
    { key: 'DGRN-4A7K-92MF-XT02', unit: null }, // null = 母行所有機器 / 不指定
  ],
}
```

**綁 unit index 而不是綁 SN 字串**：DRAFT 階段 SN 常常還沒填，綁字串會綁不到；
綁 index 時修正 SN 打錯也不會斷。畫面與票務快照一律把 index 解析成當下的 SN 顯示。

### 行為

1. HW 行卡片底部「Includes software licenses」勾選框：勾 → 新增一條子行（qty 預設 = 母行台數，
   key 預設一台一把依序綁定）；取消 → 刪除全部子行（已填 key 時先確認）。可再「Add software」加多套。
2. 子行在陣列中緊跟母行之後，畫面巢狀顯示；刪除母行或母行改成 SW 時，子行一起刪。
3. 每把 key 的 unit 下拉：All units ＋ 母行每一台。母行 qty 減少後，指向不存在台數的 key
   保留原值並標示 removed，存檔時擋下，要人工改綁——不自動改成 All units，避免默默綁錯。
4. 重複 key：同一子行內允許同一把 key 綁不同台（多台共用一把）；跨行重複或同台重複仍擋。
5. SW 供應商：表頭 `sw_supplier_name` 只在有 SW 行沒填自己的 `supplier_name` 時才必填。
6. **調整 License**：CONFIRMED 訂單的 SW 行可開「Adjust license」修改 key / 綁定 / 版本 /
   期間 / 供應商，Activity Log 記下異動前後。其他欄位仍只能在 DRAFT 編輯。
7. Service Desk：HW 票選定 SN 後，保固卡列出綁這台（含 All units）的授權，並寫入票的快照。
8. 舊存檔的字串 key 在 store 載入時轉成 `{ key, unit: null }`，不清資料。

### 不做

- 一把 key 綁「其中幾台」的子集合：用同一把 key 列多列、各綁一台表達。
- 每把 key 各自的到期日：到期日不同就拆成兩條子行。
- 子行綁到其他 HW 行的機器：跨行共用的授權用獨立 SW 行。

## 文件類型標記（2026-09-24 已實作，Steve 優化建議 4）

- 每個附件多一個 `doc_type`：`PO` 採購單、`QUOTATION` 報價單、`CONTRACT` 合約、`ACCEPTANCE` 驗收單、
  `DELIVERY` 簽收單、`OTHER` 其他。Steve 列的四類之外，加了 PO（原本就在上傳）與簽收單（出貨佐證）。
- **強制選類型**：新上傳的檔案類型為空，旁邊的下拉以橘框提示；有檔案沒選類型就不能存檔。
  舊存檔沒有 `doc_type` 的檔案顯示為 Unclassified，下次編輯時同樣要補選。
- 詳情視窗：有兩種以上類型時顯示篩選 chip（All / 各類型＋數量），每個檔案上方標類型。
- **CONFIRMED 訂單可補文件**：驗收單、簽收單都在確認後才出現，詳情視窗加「Manage documents」，
  可新增、改類型、刪除，Activity Log 記一筆異動摘要。訂單其他欄位仍只能在 DRAFT 編輯。
- 訂單文件上限從 5 個提高到 10 個（票務附件仍是 5 個）；單檔大小限制不變，受 localStorage 容量約束。

## 大量序號與 License 輸入（2026-09-30）

**問題**：一台一格手動輸入，台數一多就不實際。AISO 做售後，序號與 key 多半已在出貨明細 / 授權清單的 Excel 裡。

1. **序號整批貼上**：HW 行「Paste serials」，貼上一欄（換行、Tab、逗號、分號皆可分隔），預覽筆數與重複，
   套用後 Qty = 筆數、依序填入。
2. **掃碼槍**：序號欄按 Enter 跳下一格（掃碼槍 = 鍵盤輸入＋Enter），可連續掃。
3. **License 整批貼上**（新增訂單的軟體行、訂單確認後的 Adjust license 都有）：
   - 兩欄「序號＋Key」→ 依序號比對綁定，順序亂了也不會錯；對不到的序號列出擋下。
   - 一欄 Key → 選「依序一台一把」或「整批共用（All units）」。
   - 貼上先預覽「Unit / 序號 / Key」對照表，有錯誤不能套用；key 比台數多時擋下、少時提示哪幾台沒有 key。
   - 同一把 key 出現在多台視為共用，合法。
4. **大量時收合**：超過 12 筆只顯示前 10 筆與「Show all」，避免 modal 被幾百個欄位撐爆。
