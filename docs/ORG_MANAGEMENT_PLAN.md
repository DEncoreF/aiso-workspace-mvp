# MVP4 組織管理模組規劃（Organization Management）

**狀態**：已實作完成（2026-09-23）
**日期**：2026-09-22（v3：本期範圍縮為 AISO + 客戶兩種組織）
**前提**：MVP4 設計順序 —— Asset Registry 先隱藏、Order Management（已完成）→ Service Desk
（已完成）→ **組織管理（本篇）**。訂單與票的 `customer_org_id` 已預留為 null，等本模組回填。

## 已拍板的決定

| # | 決定 | 日期 |
|---|---|---|
| 1 | 一個帳號可屬於多個組織（一對多） | 09-17 |
| 2 | 權限由「組織角色」決定，不掛在帳號上 | 09-17 |
| 3 | `root@aiso.com` 是 Super Admin，站在所有組織與角色之上；**是系統帳號，不隸屬 AISO 組織**（AISO 的聯絡信箱另設 service.desk@aiso.com） | 09-22 / 09-23 |
| 4 | AISO 端不預設角色；**角色由使用者新建**，按模組逐項設定 CRUD | 09-22 |
| 5 | 帳號綁定「某組織的某角色」，可切換角色來切換檢視 | 09-22 |
| 6 | **權限設計做在 ORGS.type 層**：不同 type 能用的功能不同 | 09-22 |
| 7 | ORGS.type 三種：`OPERATOR` / `VENDOR` / `CUSTOMER`；VENDOR 再分 `vendor_type`：`SOFTWARE` / `HARDWARE` / `SI` | 09-22 |
| 8 | 只要是訂單上的任一供應商（HW / SW / SI 任一欄），就能查看該訂單 | 09-22 |
| 9 | **本期只做 `OPERATOR` + `CUSTOMER`**，供應商組織延後（#7、#8 保留在〈延後〉一節） | 09-22 |
| 10 | demo 一律用右下角 View as 切換視角呈現差別，不靠示範帳號登入 | 09-22 |
| 11 | 客戶組織再分 `customer_type`：`INDIVIDUAL`（個人）/ `ENTERPRISE`（企業）。個人客戶**沒有成員與角色管理** | 09-23 |

## 本期範圍

| 做 | 不做（延後） |
|---|---|
| OPERATOR（AISO）、CUSTOMER 兩種組織 | VENDOR 組織的管理、角色、登入 |
| 角色新建、模組×CRUD 權限矩陣、type 天花板 | 供應商 scope 規則、`license_keys` 遮罩 |
| 帳號一對多、綁定、切換角色檢視 | 回填 `hw/sw_supplier_org_id`、`si_org_id` |
| 回填 `customer_org_id`（訂單 + 票） | 補建 Systex |

## 參考來源

| 檔案 | 拿了什麼 |
|---|---|
| `js/seed-data.js` (`ORGS`) | 既有 6 個組織與內嵌 `members`（`org_role: OA / CM`） |
| `js/app.js` (`PORTAL_PERMISSIONS`, `hasPermission`) | 既有 9 個權限字串與集中的權限判斷點 |
| `js/app.js` (`CUSTOMER_VIEW_PERMISSIONS`, `viewAs`) | 現行「客戶視角」假開關，本模組用真角色取代 |
| `js/app.js` (`getMatchingVendorId`) | 產品 `vendor_id` 的比對；**`vendor_id` 全專案只寫不讀** |
| `docs/ORDER_MANAGEMENT_PLAN.md` | free key-in 原則、`*_org_id` 回填承諾 |
| `docs/SERVICE_DESK_PLAN.md` | 「AISO 是唯一窗口、無 vendor assignment」 |

## 權限三層模型

```
第 1 層  ORG_TYPE_CAPABILITIES   寫死。每個 type「最多能被指派」哪些 模組×CRUD
             │  天花板：角色只能從這裡挑
第 2 層  ROLES                   使用者新建。屬於某個組織，勾選 模組×CRUD
             │
第 3 層  ROLE_BINDINGS           帳號 × 角色。一個帳號可綁多個角色（跨組織、也可同組織）

Super Admin（root@aiso.com）不經過以上三層，永遠全開。
```

**為什麼要第 1 層**：角色是自由建的，沒有天花板的話，客戶組織的管理員可以替自己的角色
勾上「參數中心 Update」。type 天花板保證客戶組織怎麼建角色都碰不到營運功能。
建角色時，天花板外的格子直接 disabled。

## ORGS.type

| type | customer_type | 本期 | 種子對象 |
|---|---|---|---|
| `OPERATOR` | — | ✅ | AISO |
| `CUSTOMER` | `ENTERPRISE` | ✅ | MegaBank、GovCloud |
| `CUSTOMER` | `INDIVIDUAL` | ✅ | Wei-Ting Chen |
| `VENDOR` | — | ⏸ 資料保留、不出現在 Organizations 頁 | Phison、TPIsoftware、KDAN、AISO |

- `types` 是陣列：AISO = `['OPERATOR', 'VENDOR']` + `vendor_type: 'HARDWARE'`
  （既有 1 筆 `products.vendor_id: 'v-aiso'`）。
- `vendor_type` 欄位保留、統一大寫。之後開放供應商只需開放選項並補天花板欄位，不用升 Store 版本。
- 供應商組織資料原封不動，只當 `getMatchingVendorId` 的查找表。

## 模組 × CRUD 權限字串

統一成 `<module>.<c|r|u|d>`，取代現行零散的 `order.read` / `ticket.update` 等：

| module key | 模組 | 對應現行字串 |
|---|---|---|
| `sw_product` | Software Products | （現行無檢查，`canManageProduct` 恆 true） |
| `hw_product` | Hardware Products | 同上 |
| `compatibility` | Compatibility | `compatibility.read/update`、`compatibility.audit.read` |
| `parameter` | Parameter Center | （現行無檢查） |
| `order` | Orders | `order.read` |
| `ticket` | Service Desk | `ticket.read/create/update` |
| `asset` | Asset Registry | `asset.read/update` |
| `organization` | Organizations（含成員、角色、帳號） | 新增 |
| `activity_log` | Activity Log | （現行無檢查；只有 R） |

Settings 是個人資料頁，不設權限。

## 第 1 層：天花板（`ORG_TYPE_CAPABILITIES`）

| 模組 | OPERATOR | CUSTOMER·ENTERPRISE | CUSTOMER·INDIVIDUAL |
|---|---|---|---|
| sw_product | CRUD | — | — |
| hw_product | CRUD | — | — |
| compatibility | CRU（無刪除動作） | — | — |
| parameter | CRUD | — | — |
| order | CRUD | 本方 R | 本方 R |
| ticket | CRU（票不刪，只關） | 本方 CRU | 本方 CRU |
| asset | CRUD | 本方 RU | 本方 RU |
| organization | CRUD | 本組織 CRUD | **—（個人就是那個帳號，沒有成員可管）** |
| activity_log | R | 本方 R | 本方 R |

個人客戶因此連 Organizations 這個 nav 都看不到（需要 `organization.r`）。
建立個人客戶時，組織、`Owner` 角色、那個人的帳號三者一次建立；組織詳情用 **Account**
分頁唯讀顯示那個帳號，取代 Members / Roles 兩個分頁。要停用就從 Accounts 頁停用帳號。

## 資料範圍（scope）

權限回答「能不能做」，scope 回答「對哪幾筆能做」，由**作用中角色所屬組織**決定：

| 作用中組織 | order | ticket | asset | organization |
|---|---|---|---|---|
| OPERATOR | 全部 | 全部 | 全部 | 全部 OPERATOR / CUSTOMER 組織 |
| CUSTOMER | `customer_org_id = 我` 且非 DRAFT | `customer_org_id = 我` | `service_org_id = 我` | 只有自己 |

**順序陷阱**：現行 `customer_org_id` 全是 null。先接 scope 再回填，客戶登入會看到空白畫面，
而且看起來像 bug。所以〈實作切分〉把回填排在 scope 之前。

## 資料模型（localStorage，v4 key；Store `VERSION` 7 → 8）

```js
// USERS — 帳號本身，不帶權限
{ id: 'u-root', name: 'System Root', email: 'root@aiso.com',  // email 唯一，大小寫不敏感
  status: 'active',              // active | disabled
  is_super_admin: true,          // 只有 root 為 true；不可停用、不需綁角色
  created_at: '', updated_at: '' }

// ORGS — 改寫：type → types[]，members 移出；從 const 改 let 並持久化
{ id: 'c-megabank', name: 'MegaBank Corp',   // 與訂單 free key-in 比對的鍵，不可重名
  types: ['CUSTOMER'], vendor_type: null,    // types 含 VENDOR 時：SOFTWARE | HARDWARE | SI
  status: 'active', contact_email: '', note: '',
  created_at: '', updated_at: '' }

// ROLES — 使用者新建，屬於某個組織
{ id: 'r-mb-admin', org_id: 'c-megabank', name: 'Admin',   // 同組織內不可重名
  description: '',
  permissions: ['order.r', 'ticket.c', 'ticket.r', 'ticket.u', ...],
  // 儲存時過濾掉天花板外的字串
  created_at: '', updated_at: '' }

// ROLE_BINDINGS — 帳號 × 角色；org 由 role 推得，不重複存
{ id: 'rb-0001', user_id: 'u-tom', role_id: 'r-mb-admin',
  status: 'active',              // active | suspended
  created_at: '' }
// (user_id, role_id) 唯一。同一人可綁同組織的兩個角色。
```

**權限不做聯集**：一次只有一個作用中綁定，畫面就是那個角色看到的樣子。
要兩個角色的能力同時生效，就建一個涵蓋兩者的新角色。

## 整體流程

### A. 登入

```
email + 密碼（prototype 共用 aiso1234）
  ├─ is_super_admin → 直接進入，全開
  └─ 一般帳號 → 查 active 綁定（綁定 active、組織 active、組織 type 本期有開放）
       ├─ 0 筆 → 拒絕：「此帳號尚未被指派任何角色」（與密碼錯誤分開講）
       ├─ 1 筆 → 直接進入
       └─ 多筆 → 「選擇角色」畫面（每列：組織名 · 角色名 · type badge）
```

session 只存 `{ user_id, active_binding_id }`（Super Admin 為 `null`）。
`currentUser` 保留變數名（app.js 數十處在用），改成推導出的
`{ id, name, email, org, role, permissions, label }`。

### B. 切換角色檢視

- **一般帳號**：側欄使用者卡點開 → 列出自己所有綁定 → 選一個 → 只改 `active_binding_id`，
  不重新登入 → 重建 nav、重跑 scope、落在第一個看得到的頁。只有一個綁定時不顯示切換器。
- **Super Admin**：右下角 View-as 保留外觀，選單改列**全部組織的全部角色**，選了就以該角色檢視，
  可隨時切回。`CUSTOMER_VIEW_PERMISSIONS` 與 `isCustomerView()` 特例分支刪除，
  不與真角色並存兩套權限邏輯。

### C. 建角色（Organizations → 組織詳情 → Roles）

```
New role → 名稱 + 說明
        → 權限矩陣：列 = 模組、欄 = C / R / U / D
             天花板外的格子 disabled + tooltip（「客戶組織不可使用此功能」）
             勾 C/U/D 時自動勾 R
        → 儲存
```

刪角色：還有人綁定時擋下並列出是誰。

### D. 加成員並綁角色（Organizations → 組織詳情 → Members）

```
Add member → 輸入 email
  ├─ 已存在 → 沿用帳號（UI 明講「此帳號已存在，將加入本組織」）← 一對多發生在這
  └─ 不存在 → 建新帳號
→ 從本組織的角色中選一個或多個 → 建立綁定
```

移除成員 = 刪他在本組織的所有綁定，**不刪帳號**。全系統剩 0 個綁定時警告「此帳號將無法登入」。
組織還沒有角色時，Add member 引導先建角色。

### E. 回填（隨本模組上線執行一次）

| 來源欄位 | 對到 | 比對規則 |
|---|---|---|
| `ORDERS.customer_name` | `customer_org_id` | name 全等、不分大小寫，且 types 含 `CUSTOMER` |
| `TICKETS.customer_name` | `customer_org_id` | 同上 |

對不上的留 null，Orders 詳情客戶欄位旁顯示「未連結組織」chip + `建立此組織` / `連結到既有組織`。
訂單表單的客戶欄位加 `datalist` 建議既有客戶組織名。**free key-in 維持，不改必選。**

## UI 範圍（nav：Organizations，權限 `organization.r`）

1. **Organizations 分頁**：清單（名稱、type badge、成員數、角色數、關聯訂單數、狀態）+ 搜尋 +
   建立/編輯 modal（type 只能選 OPERATOR / CUSTOMER）。
2. **組織詳情 drawer**，三個 tab：Profile（基本資料、關聯訂單與票）/ Roles / Members。
3. **Accounts 分頁**：一列一帳號，展開看「他在哪些組織、綁了哪些角色」。停用帳號在這裡。

客戶組織的使用者進 Organizations 只看得到自己那一筆。所有異動寫入 Activity Log。

**不做**：密碼雜湊與改密碼、邀請信、SSO、組織階層、權限聯集、角色範本複製。

## 與其他模組的接點

| 模組 | 改動 |
|---|---|
| 全部 | 14 處 `PORTAL_PERMISSIONS.*` / `canManageProduct` 改用新字串；nav 的 `permission` 改用新字串 |
| Orders | 回填 `customer_org_id`；scope；客戶欄位加建議清單 |
| Service Desk | 回填 `customer_org_id`；scope；移除 `CUSTOMER_VIEW_PERMISSIONS` |
| 軟硬體產品 | 首次真正做權限檢查；`getMatchingVendorId` 改讀 `types[]` |
| Asset Registry（隱藏中） | `service_org_id` 已是真 id，解除隱藏時直接可用 |
| Store | `VERSION` 7 → 8：新增 ORGS / USERS / ROLES / ROLE_BINDINGS，舊存檔重置 |

## 實作切分（預估我執行的時間）

1. ✅ 資料模型 + seed：四張表、`types[]` / 大寫 `vendor_type`、天花板表、示範角色與帳號；Store 升版。
2. ✅ 回填 `customer_org_id` + 未連結提示（**排在 scope 前**）。
3. ✅ 權限核心：`hasPermission()` 走作用中角色並套天花板、權限字串改 `<module>.<c|r|u|d>`、nav 改由 read 權限決定、
   刪 `CUSTOMER_VIEW_PERMISSIONS`。**併入**原第 4 步的 Super Admin View-as（改列全部角色）
   與原第 5 步的 Orders / Service Desk scope——拆掉客戶特例後這兩塊不做就無法運作。
4. ✅ 登入三條路 + 選擇角色畫面 + 側欄切換器。
5. ✅ scope 接進 Asset（隱藏中）。
6. ✅ Organizations 清單 + 詳情 Profile / Members（詳情用 modal，與訂單詳情一致；Roles tab 先唯讀）。
7. ✅ Roles tab：權限矩陣、天花板顯示為「—」、刪除保護、不能改自己正在用的角色。
8. ✅ Accounts 分頁（**只有 AISO 端看得到**：帳號跨組織，客戶管理員只從自己組織的 Members 管人）。

八步全部完成（2026-09-23）。

## 示範資料（seed）

| 帳號 | 綁定 | 用途 |
|---|---|---|
| root@aiso.com | Super Admin | 全開、可 View-as 任何角色 |
| tom@megabank.com | MegaBank · Admin | 客戶管理員 |
| amy@megabank.com | MegaBank · Member | 客戶一般成員 |
| robert@govcloud.gov | GovCloud · Admin **+** MegaBank · Member | 示範一對多與切換角色 |
| weiting.chen@gmail.com | Wei-Ting Chen · Owner | 個人客戶（帶一張 PO-2026-0004） |

既有 seed 的 `OA` / `CM` 轉成各客戶組織的 `Admin` / `Member`。
AISO 組織不建角色（決定 #4），AISO 端的角色與員工帳號由 root 在 UI 上新建。
供應商組織的既有成員（James、Kevin、David、Grace、Eric）本期不轉成帳號。

## 延後：供應商組織（決定 #7、#8 保留於此）

開放時要做的事：
1. Organizations 建立 modal 開放 `VENDOR` + `vendor_type`（SOFTWARE / HARDWARE / SI）；補建 Systex。
2. 天花板補三欄：HW / SW 供應商 = 自家產品 RU + order 本方 R；SI = order 本方 R；三者都不碰 ticket。
3. 供應商看訂單規則：`hw_supplier_org_id === me || sw_supplier_org_id === me || si_org_id === me`，
   看得到整張非 DRAFT 訂單。
4. `license_keys` 遮罩：只對 OPERATOR、該單客戶、該行 SW 供應商顯示。
5. 回填 `hw_supplier_org_id` / `sw_supplier_org_id` / `si_org_id`。

資料結構本期已備好（`types[]`、`vendor_type`），開放時不用升 Store 版本。
