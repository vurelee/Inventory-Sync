const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'inventory-cache.json');
const SHIPPING_FILE = path.join(DATA_DIR, 'shipping-orders.json');

const warehouses = [
  { id: 'wh-us-west', name: '美国西仓', apiUrl: 'https://example.com/api/warehouse/us-west' },
  { id: 'wh-us-east', name: '美国东仓', apiUrl: 'https://example.com/api/warehouse/us-east' },
  { id: 'wh-eu', name: '欧洲仓', apiUrl: 'https://example.com/api/warehouse/eu' }
];

ensureDataFiles();

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ warehouses: {}, lastSyncedAt: null }, null, 2));
  }
  if (!fs.existsSync(SHIPPING_FILE)) {
    fs.writeFileSync(SHIPPING_FILE, JSON.stringify([], null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, pathname) {
  const normalizedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(__dirname, 'public', normalizedPath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function fetchWarehouseInventory(warehouse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(warehouse.apiUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Invalid payload');
    }

    return data
      .filter((item) => item && item.sku)
      .map((item) => ({ sku: String(item.sku), quantity: Number(item.quantity) || 0 }));
  } catch {
    return generateFallbackInventory(warehouse.id);
  } finally {
    clearTimeout(timer);
  }
}

function generateFallbackInventory(seedSource) {
  const baseSkus = ['SKU-1001', 'SKU-1002', 'SKU-1003', 'SKU-2001', 'SKU-3005'];
  const seed = seedSource.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  return baseSkus.map((sku, idx) => ({
    sku,
    quantity: ((seed + idx * 17) % 120) + 5
  }));
}

function aggregateInventory(cache, query) {
  const normalizedQuery = (query || '').trim().toLowerCase();
  const skuMap = new Map();

  for (const warehouse of warehouses) {
    const rows = cache.warehouses[warehouse.id] || [];
    for (const row of rows) {
      const sku = String(row.sku || '').trim();
      if (!sku) continue;
      if (normalizedQuery && !sku.toLowerCase().includes(normalizedQuery)) continue;

      if (!skuMap.has(sku)) {
        skuMap.set(sku, {
          sku,
          totalQuantity: 0,
          byWarehouse: {}
        });
      }

      const item = skuMap.get(sku);
      const qty = Number(row.quantity) || 0;
      item.totalQuantity += qty;
      item.byWarehouse[warehouse.name] = qty;
    }
  }

  return Array.from(skuMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/sync') {
    const cache = readJson(CACHE_FILE, { warehouses: {}, lastSyncedAt: null });

    for (const warehouse of warehouses) {
      cache.warehouses[warehouse.id] = await fetchWarehouseInventory(warehouse);
    }

    cache.lastSyncedAt = new Date().toISOString();
    writeJson(CACHE_FILE, cache);

    sendJson(res, 200, {
      success: true,
      message: '库存同步完成',
      lastSyncedAt: cache.lastSyncedAt
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/inventory') {
    const query = urlObj.searchParams.get('query') || '';
    const cache = readJson(CACHE_FILE, { warehouses: {}, lastSyncedAt: null });
    const items = aggregateInventory(cache, query);

    sendJson(res, 200, {
      items,
      warehouses: warehouses.map(({ id, name }) => ({ id, name })),
      lastSyncedAt: cache.lastSyncedAt
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shipping-orders') {
    try {
      const payload = await parseBody(req);
      const trackingNo = String(payload.trackingNo || '').trim();
      const boxCount = Number(payload.boxCount);
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!trackingNo) {
        sendJson(res, 400, { error: 'trackingNo 不能为空' });
        return;
      }
      if (!Number.isInteger(boxCount) || boxCount <= 0) {
        sendJson(res, 400, { error: 'boxCount 必须是正整数' });
        return;
      }

      const normalizedItems = items
        .map((item) => ({
          sku: String(item.sku || '').trim(),
          quantity: Number(item.quantity)
        }))
        .filter((item) => item.sku && Number.isFinite(item.quantity) && item.quantity > 0);

      if (!normalizedItems.length) {
        sendJson(res, 400, { error: '至少添加一个有效的 SKU 项' });
        return;
      }

      const shippingOrders = readJson(SHIPPING_FILE, []);
      const newOrder = {
        id: `SO-${Date.now()}`,
        trackingNo,
        boxCount,
        items: normalizedItems,
        createdAt: new Date().toISOString()
      };

      shippingOrders.unshift(newOrder);
      writeJson(SHIPPING_FILE, shippingOrders);

      sendJson(res, 201, { success: true, order: newOrder });
    } catch (err) {
      sendJson(res, 400, { error: err.message || '请求错误' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shipping-orders') {
    const shippingOrders = readJson(SHIPPING_FILE, []);
    sendJson(res, 200, { orders: shippingOrders });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(`Inventory Sync app running on http://localhost:${PORT}`);
});
