# 库存同步网页应用（Inventory Sync）

一个轻量的 Node.js 网页应用，支持：

1. **库存展示与同步**
   - 从多个仓库 API 拉取库存。
   - 合并展示总库存和分仓库存。
   - 支持 SKU 模糊搜索。
   - 同步结果缓存到本地 `data/inventory-cache.json`。

2. **建立发货单**
   - 类似亚马逊头程入库单，包含跟踪号、箱数和 SKU 明细。
   - 发货单保存到 `data/shipping-orders.json`。

## 运行方式

```bash
npm start
```

打开 `http://localhost:3000`。

## API 一览

- `POST /api/sync`：同步库存到本地缓存。
- `GET /api/inventory?query=SKU关键词`：读取库存（含模糊搜索）。
- `POST /api/shipping-orders`：创建发货单。
- `GET /api/shipping-orders`：查询发货单列表。
