# MVP4 售後服務窗口（Service Desk）

**狀態**：已實作（2026-09-08）
**Mockup**：`docs/mockups/service-desk-mockup.html`（可點擊的靜態稿，樣式與正式碼相同）

## 設計決定

1. **票掛在訂單行，不掛表頭**。`ORDER_LINES` 已帶 scope / 序號 / 保固期 / 授權期 / SLA，
   是 entitlement 的現成來源；表頭只有名稱。HW 行一台一票（`serial_no` 必填，行上有序號時）。
2. **AISO 是唯一窗口**。沒有 vendor assignment；供應商與 SI 只以參考資訊出現在 entitlement 卡。
   訊息 `author_type` 只有 `CUSTOMER` / `INTERNAL`，內部備註用 `is_internal` 旗標，客戶看不到。
3. **只有 CONFIRMED 訂單可開票**。DRAFT 序號可能空白；CANCELLED 不再服務。
4. **建票時快照**（`snapshot`）：order_no、line_no、product_name、sla_plan、coverage_kind/end、
   supplier_name、si_name、license_key。之後改單或取消不改舊票，畫面也不需要 join。
5. **客戶組 = `customer_name` 分組**。`customer_org_id` 照 free key-in 原則留 null，等組織管理回填。
6. **Store 不升版**。`load()` 用 `Array.isArray` 防呆，舊存檔沒有 `TICKETS` 就沿用 seed，不清資料。

## 資料模型（`seed-data.js`）

```js
TICKETS[] = { id, ticket_no, customer_name, customer_org_id, order_id, order_line_id, serial_no, scope,
              subject, description, category, priority, status, channel, reported_by,
              snapshot: {...}, created_at, updated_at, first_response_at, resolved_at }
TICKET_MESSAGES[] = { id, ticket_id, author_type, author_name, is_internal, body, created_at,
                      attachments: [{ id, name, type, size, is_image, data_url }] }
```

狀態：`OPEN → IN_PROGRESS ⇄ AWAITING_CUSTOMER_INFO → RESOLVED → CLOSED`（select 直接切，無鎖）。

**內部處理狀態（2026-09-23 新增）**：公開狀態給客戶看，內部狀態說「desk 現在在等誰」，
兩者分開存。`internal_state` = `NONE` / `HW_SUPPLIER` / `SW_SUPPLIER` / `SI` / `AISO_INTERNAL`，
另存 `internal_party`（轉出當下的對象名，取自訂單，回退到票的快照）與 `internal_since`。
只有 AISO（`ticket.u` + OPERATOR）看得到與改得動；客戶看到的永遠只有公開狀態。
轉出時自動寫一則內部備註當軌跡；訂單沒有記載該對象時擋下不讓轉；票轉 RESOLVED/CLOSED 時自動歸零。
決定 #2（AISO 是唯一窗口、無 vendor assignment）不變：這是 AISO 自己的待辦標記，不是把票派給供應商。
首次回應目標（`TICKET_FIRST_RESPONSE_HOURS`）：7x24 → 4h、On-site → 8h、5x8 → 24h、無 SLA → 24h。
超時且尚無 AISO 對客回覆即標 Overdue。

## UI

- Nav **Service Desk**（權限 `ticket.read`）：統計四格、狀態 filter-tab、搜尋、客戶 select（管理端）。
- **New Ticket**：Customer → Order → Line → Serial 四步連動，右欄 entitlement 卡 + 請求欄位。
- **詳情**：左訊息串 + 回覆框（Reply to customer / Internal note），右狀態、首次回應進度、
  entitlement 快照、訂單/BOM、同訂單其他票。
- **Orders 詳情**每行多一顆 Open ticket（CONFIRMED 且有 `ticket.create` 才出現），帶入預設值。

## 右下角 View as（Customer 視角）

純前端 demo 開關，不動資料：
- `viewAs = { mode: 'admin' | 'customer', customer_name }`；`hasPermission()` 在客戶視角只回
  `CUSTOMER_VIEW_PERMISSIONS`（order.read / ticket.read / ticket.create）。
- Nav 只留 `customer: true` 的項目（Orders、Service Desk）；側欄使用者卡顯示客戶名 + Customer view。
- Orders 只列該客戶非 DRAFT 訂單，隱藏 New/Edit/Cancel；Service Desk 只列該客戶票，
  建票時客戶固定、channel 固定 Portal form；詳情看不到內部備註、不能改狀態、回覆者為客戶。
- 登出或切回 Super Admin 即還原。真正的客戶帳號等組織管理。

## 附件

建票 modal 與詳情回覆框都可附檔（拖放或點選）。存在訊息的 `attachments` 內，以 data URL 落地 localStorage：
圖片經 `Store.compressImage` 縮到 800px；PDF/TXT/LOG/CSV/JSON 限 500 KB；每則最多 5 檔。
圖片顯示縮圖、點開全螢幕預覽；其他檔案為下載 chip。真正的檔案儲存等後端。

## 不做（等後端）

Email 通知、SLA 日曆（工作日/假日）、供應商轉派、票務 CSV 匯出。
