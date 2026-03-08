const syncBtn = document.getElementById('syncBtn');
const searchInput = document.getElementById('searchInput');
const syncInfo = document.getElementById('syncInfo');
const inventoryHead = document.getElementById('inventoryHead');
const inventoryBody = document.getElementById('inventoryBody');

const itemRows = document.getElementById('itemRows');
const addItemBtn = document.getElementById('addItemBtn');
const shippingForm = document.getElementById('shippingForm');
const ordersList = document.getElementById('ordersList');

let warehouseNames = [];

function createItemRow(defaultItem = { sku: '', quantity: 1 }) {
  if (!itemRows) return;

  const div = document.createElement('div');
  div.className = 'item-row';
  div.innerHTML = `
    <input placeholder="SKU" value="${defaultItem.sku}" class="sku-input" required />
    <input type="number" min="1" value="${defaultItem.quantity}" class="qty-input" required />
    <button type="button" class="remove-item">删除</button>
  `;
  div.querySelector('.remove-item').onclick = () => div.remove();
  itemRows.appendChild(div);
}

async function loadInventory() {
  if (!searchInput || !inventoryHead || !inventoryBody || !syncInfo) return;

  const query = encodeURIComponent(searchInput.value || '');
  const res = await fetch(`/api/inventory?query=${query}`);
  const data = await res.json();

  warehouseNames = data.warehouses.map((w) => w.name);
  inventoryHead.innerHTML = `<tr><th>SKU</th>${warehouseNames.map((name) => `<th>${name}</th>`).join('')}<th>总库存</th></tr>`;
  inventoryBody.innerHTML = data.items
    .map((item) => `
      <tr>
        <td>${item.sku}</td>
        ${warehouseNames.map((name) => `<td>${item.byWarehouse[name] ?? 0}</td>`).join('')}
        <td>${item.totalQuantity}</td>
      </tr>
    `)
    .join('');

  syncInfo.textContent = data.lastSyncedAt
    ? `最近同步：${new Date(data.lastSyncedAt).toLocaleString()}`
    : '尚未同步';
}

async function syncInventory() {
  if (!syncBtn) return;

  syncBtn.disabled = true;
  syncBtn.textContent = '同步中...';
  try {
    await fetch('/api/sync', { method: 'POST' });
    await loadInventory();
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '同步库存';
  }
}

async function loadOrders() {
  if (!ordersList) return;

  const res = await fetch('/api/shipping-orders');
  const data = await res.json();
  ordersList.innerHTML = data.orders
    .map((order) => `
      <li>
        <strong>${order.id}</strong> | 跟踪号: ${order.trackingNo} | 箱数: ${order.boxCount}<br />
        SKU: ${order.items.map((it) => `${it.sku} × ${it.quantity}`).join('；')}<br />
        创建时间: ${new Date(order.createdAt).toLocaleString()}
      </li>
    `)
    .join('');
}

if (shippingForm) {
  shippingForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(shippingForm);
    const items = Array.from(itemRows.querySelectorAll('.item-row')).map((row) => ({
      sku: row.querySelector('.sku-input').value,
      quantity: Number(row.querySelector('.qty-input').value)
    }));

    const payload = {
      trackingNo: formData.get('trackingNo'),
      boxCount: Number(formData.get('boxCount')),
      items
    };

    const res = await fetch('/api/shipping-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '保存失败');
      return;
    }

    shippingForm.reset();
    itemRows.innerHTML = '';
    createItemRow();
    await loadOrders();
  };
}

if (searchInput) {
  searchInput.oninput = () => {
    loadInventory();
  };
}

if (addItemBtn) {
  addItemBtn.onclick = () => createItemRow();
}

if (syncBtn) {
  syncBtn.onclick = syncInventory;
}

if (itemRows) {
  createItemRow();
}

if (inventoryBody) {
  loadInventory();
}

if (ordersList) {
  loadOrders();
}
