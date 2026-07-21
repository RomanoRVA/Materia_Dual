const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const dotenv = require('dotenv');
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const runtimeRoot = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const envFilePath = path.join(runtimeRoot, '.env');
dotenv.config({ path: envFilePath });

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

const defaultEmployees = [
  { username: 'admin1', accessCode: '200640', role: 'admin', name: 'Administrador' },
  { username: 'cajero1', accessCode: '100540', role: 'cashier', name: 'Caja Principal' },
];

const defaultRoles = [
  { code: 'admin', name: 'Administrador', description: 'Acceso total al sistema.', isSystem: true },
  { code: 'cashier', name: 'Cajero', description: 'Operacion de caja, mesas y cobros.', isSystem: true },
  { code: 'waiter', name: 'Mesero', description: 'Operacion de mesas y envio de pedidos.', isSystem: true },
  { code: 'kitchen', name: 'Cocina', description: 'Consulta y actualizacion de cocina.', isSystem: true },
];

const defaultPermissions = [
  { code: 'catalog.products.read', module: 'catalog', action: 'products.read', name: 'Ver productos' },
  { code: 'admin.products.manage', module: 'admin.products', action: 'manage', name: 'Administrar productos' },
  { code: 'admin.employees.manage', module: 'admin.employees', action: 'manage', name: 'Administrar usuarios' },
  { code: 'admin.sales.read', module: 'admin.sales', action: 'read', name: 'Consultar ventas' },
  { code: 'admin.sales.cutoff', module: 'admin.sales', action: 'cutoff', name: 'Realizar corte' },
  { code: 'admin.business.manage', module: 'admin.business', action: 'manage', name: 'Administrar empresas y sucursales' },
  { code: 'orders.read', module: 'orders', action: 'read', name: 'Consultar ordenes' },
  { code: 'orders.create', module: 'orders', action: 'create', name: 'Crear ordenes' },
  { code: 'orders.status.update', module: 'orders', action: 'status.update', name: 'Actualizar estado de ordenes' },
  { code: 'orders.pay', module: 'orders', action: 'pay', name: 'Cobrar ordenes' },
  { code: 'orders.print.kitchen', module: 'orders.print', action: 'kitchen', name: 'Imprimir comanda' },
  { code: 'orders.print.customer', module: 'orders.print', action: 'customer', name: 'Imprimir ticket cliente' },
  { code: 'tables.read', module: 'tables', action: 'read', name: 'Consultar mesas' },
  { code: 'tables.manage', module: 'tables', action: 'manage', name: 'Administrar mesas' },
  { code: 'auth.sessions.read', module: 'auth.sessions', action: 'read', name: 'Consultar sesiones' },
  { code: 'auth.sessions.revoke', module: 'auth.sessions', action: 'revoke', name: 'Cerrar sesiones' },
  { code: 'security.permissions.read', module: 'security.permissions', action: 'read', name: 'Consultar permisos' },
  { code: 'security.permissions.manage', module: 'security.permissions', action: 'manage', name: 'Administrar permisos' },
  { code: 'inventory.read', module: 'inventory', action: 'read', name: 'Consultar inventario' },
  { code: 'inventory.movements.create', module: 'inventory.movements', action: 'create', name: 'Registrar movimientos de inventario' },
  { code: 'inventory.adjust', module: 'inventory', action: 'adjust', name: 'Ajustar inventario' },
  { code: 'inventory.transfer', module: 'inventory', action: 'transfer', name: 'Transferir inventario' },
  { code: 'inventory.alerts.read', module: 'inventory.alerts', action: 'read', name: 'Consultar alertas de inventario' },
];

const rolePermissionMap = {
  admin: defaultPermissions.map((permission) => permission.code),
  cashier: [
    'catalog.products.read',
    'orders.read',
    'orders.create',
    'orders.status.update',
    'orders.pay',
    'orders.print.kitchen',
    'orders.print.customer',
    'tables.read',
    'tables.manage',
    'auth.sessions.read',
    'auth.sessions.revoke',
    'inventory.read',
    'inventory.alerts.read',
  ],
  waiter: [
    'catalog.products.read',
    'orders.read',
    'orders.create',
    'orders.print.kitchen',
    'orders.print.customer',
    'tables.read',
    'tables.manage',
    'auth.sessions.read',
    'auth.sessions.revoke',
  ],
  kitchen: ['orders.read', 'orders.status.update', 'auth.sessions.read', 'auth.sessions.revoke'],
};

const orders = [];
const telemetryEvents = [];
let orderSequence = 1;

const logsDir = path.join(runtimeRoot, 'logs');
const telemetryLogFile = path.join(logsDir, 'telemetry-events.jsonl');
const printingEnabled = process.env.PRINTING_ENABLED === 'true';
const kitchenPrinters = parsePrinterTargets(process.env.KITCHEN_PRINTERS || '');
const cashierPrinters = parsePrinterTargets(process.env.CASHIER_PRINTERS || '');
const accessTokenTtlMinutes = Number(process.env.ACCESS_TOKEN_TTL_MINUTES || 480);
const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const loginLockWindowMinutes = Number(process.env.LOGIN_LOCK_WINDOW_MINUTES || 15);
const loginLockMaxAttempts = Number(process.env.LOGIN_LOCK_MAX_ATTEMPTS || 5);
const passwordResetTtlMinutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 20);
const defaultEmpresa = {
  legalName: process.env.DEFAULT_EMPRESA_LEGAL_NAME || 'POS Los Pachecos',
  tradeName: process.env.DEFAULT_EMPRESA_TRADE_NAME || 'POS Los Pachecos',
  taxId: process.env.DEFAULT_EMPRESA_TAX_ID || 'DEFAULT',
};
const defaultSucursal = {
  code: process.env.DEFAULT_SUCURSAL_CODE || 'MATRIZ',
  name: process.env.DEFAULT_SUCURSAL_NAME || 'Matriz',
};
let defaultBusinessContext = null;

// Middleware base para recibir JSON en futuras rutas del POS.
app.use(express.json());

// CORS abierto para onboarding local (frontend servido desde archivo o puerto distinto).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-id, x-user-role, x-session-id, x-device-id, x-device-name, x-empresa-id, x-sucursal-id',
  );
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

function recordTelemetry(orderId, eventType, metadata = {}) {
  const event = {
    id: telemetryEvents.length + 1,
    orderId,
    eventType,
    metadata,
    timestamp: new Date().toISOString(),
  };

  telemetryEvents.push(event);

  try {
    fs.appendFileSync(telemetryLogFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    console.error('[telemetry] No fue posible escribir evento en disco:', error.message);
  }
}

function ensureLogsStorage() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function loadTelemetryFromDisk() {
  if (!fs.existsSync(telemetryLogFile)) {
    return;
  }

  const content = fs.readFileSync(telemetryLogFile, 'utf8').trim();
  if (!content) {
    return;
  }

  const lines = content.split('\n');

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      telemetryEvents.push(event);
    } catch (error) {
      console.warn('[telemetry] Linea invalida ignorada en telemetry-events.jsonl');
    }
  }
}

function findOrder(orderId) {
  return orders.find((item) => item.id === Number(orderId));
}

function isOpenOrder(order) {
  return !order?.payment?.paid;
}

function findLatestOpenOrderByTable(tableNumber) {
  return orders
    .filter((order) => Number(order?.table?.number) === Number(tableNumber) && isOpenOrder(order))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
}

function isSameOrderOwner(order, user) {
  if (!order || !user) {
    return false;
  }

  if (Number.isInteger(order.createdByUserId) && Number.isInteger(user.id)) {
    return Number(order.createdByUserId) === Number(user.id);
  }

  const orderOwner = String(order.createdBy || '').trim().toLowerCase();
  const username = String(user.username || '').trim().toLowerCase();
  return Boolean(orderOwner && username && orderOwner === username);
}

function ensureWaiterCanUseTable(authUser, tableNumber) {
  if (!authUser || authUser.role !== 'waiter' || !Number.isInteger(Number(tableNumber))) {
    return { ok: true };
  }

  const openOrder = findLatestOpenOrderByTable(Number(tableNumber));
  if (!openOrder) {
    return { ok: true };
  }

  if (isSameOrderOwner(openOrder, authUser)) {
    return { ok: true };
  }

  return {
    ok: false,
    orderId: openOrder.id,
    owner: openOrder.createdBy || 'otro usuario',
  };
}

function toProductResponse(product) {
  return {
    id: product.id,
    empresaId: product.empresaId === null || product.empresaId === undefined ? null : Number(product.empresaId),
    sucursalId: product.sucursalId === null || product.sucursalId === undefined ? null : Number(product.sucursalId),
    name: product.name,
    category: product.category,
    price: Number(product.price),
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function parsePrice(rawPrice) {
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return Number(price.toFixed(2));
}

function parsePositiveDecimal(rawValue, decimals = 3) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function normalizeLocationKey(rawValue) {
  const locationKey = String(rawValue || 'global').trim().toLowerCase();
  return locationKey.slice(0, 80) || 'global';
}

function toInventoryStockResponse(stock) {
  return {
    id: Number(stock.id),
    productId: stock.productId === null || stock.productId === undefined ? null : Number(stock.productId),
    productName: stock.productName,
    sucursalId: stock.sucursalId === null || stock.sucursalId === undefined ? null : Number(stock.sucursalId),
    locationKey: stock.locationKey,
    quantity: Number(stock.quantity || 0),
    averageCost: Number(stock.averageCost || 0),
    lastCost: Number(stock.lastCost || 0),
    minStock: Number(stock.minStock || 0),
    isActive: Boolean(stock.isActive),
    createdAt: stock.createdAt,
    updatedAt: stock.updatedAt,
  };
}

function toInventoryMovementResponse(movement) {
  return {
    id: Number(movement.id),
    productId: movement.productId === null || movement.productId === undefined ? null : Number(movement.productId),
    productName: movement.productName,
    fromStockId: movement.fromStockId === null || movement.fromStockId === undefined ? null : Number(movement.fromStockId),
    toStockId: movement.toStockId === null || movement.toStockId === undefined ? null : Number(movement.toStockId),
    type: movement.type,
    direction: movement.direction,
    quantity: Number(movement.quantity || 0),
    unitCost: Number(movement.unitCost || 0),
    totalCost: Number(movement.totalCost || 0),
    previousQuantity: movement.previousQuantity === null || movement.previousQuantity === undefined ? null : Number(movement.previousQuantity),
    newQuantity: movement.newQuantity === null || movement.newQuantity === undefined ? null : Number(movement.newQuantity),
    referenceType: movement.referenceType || null,
    referenceId: movement.referenceId || null,
    reason: movement.reason || null,
    notes: movement.notes || null,
    createdByUserId: movement.createdByUserId === null || movement.createdByUserId === undefined ? null : Number(movement.createdByUserId),
    createdByUser: movement.createdByUser || null,
    createdAt: movement.createdAt,
  };
}

function toInventoryAlertResponse(alert) {
  return {
    id: Number(alert.id),
    stockId: Number(alert.stockId),
    productId: alert.productId === null || alert.productId === undefined ? null : Number(alert.productId),
    type: alert.type,
    status: alert.status,
    threshold: Number(alert.threshold || 0),
    currentQuantity: Number(alert.currentQuantity || 0),
    message: alert.message,
    createdAt: alert.createdAt,
    resolvedAt: alert.resolvedAt || null,
  };
}

async function findProductSnapshot(productId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id, name FROM products WHERE id = ? AND isActive = 1 LIMIT 1',
    productId,
  );

  return rows[0] || null;
}

async function getInventoryStock(stockId) {
  const rows = await prisma.$queryRawUnsafe('SELECT * FROM inventory_stock WHERE id = ? LIMIT 1', stockId);
  return rows[0] || null;
}

async function getOrCreateInventoryStock(productId, locationKey = 'global', sucursalId = null, minStock = null) {
  const product = await findProductSnapshot(productId);
  if (!product) {
    return null;
  }

  const normalizedLocationKey = normalizeLocationKey(locationKey);
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO inventory_stock (productId, productName, sucursalId, locationKey, quantity, averageCost, lastCost, minStock, isActive, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      productName = VALUES(productName),
      sucursalId = COALESCE(VALUES(sucursalId), sucursalId),
      minStock = IF(VALUES(minStock) > 0, VALUES(minStock), minStock),
      isActive = 1,
      updatedAt = NOW()
    `,
    product.id,
    product.name,
    sucursalId,
    normalizedLocationKey,
    minStock === null || minStock === undefined ? 0 : Number(minStock),
  );

  const rows = await prisma.$queryRawUnsafe(
    'SELECT * FROM inventory_stock WHERE productId = ? AND locationKey = ? LIMIT 1',
    product.id,
    normalizedLocationKey,
  );

  return rows[0] || null;
}

async function refreshInventoryAlert(stockId) {
  const stock = await getInventoryStock(stockId);
  if (!stock) {
    return;
  }

  const quantity = Number(stock.quantity || 0);
  const minStock = Number(stock.minStock || 0);

  if (minStock > 0 && quantity <= minStock) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO inventory_alerts (stockId, productId, type, status, threshold, currentQuantity, message, createdAt)
      SELECT ?, ?, 'min_stock', 'open', ?, ?, ?, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_alerts
        WHERE stockId = ? AND type = 'min_stock' AND status = 'open'
      )
      `,
      stock.id,
      stock.productId,
      minStock,
      quantity,
      `Stock minimo alcanzado para ${stock.productName}`,
      stock.id,
    );

    await prisma.$executeRawUnsafe(
      `
      UPDATE inventory_alerts
      SET currentQuantity = ?, threshold = ?, message = ?, createdAt = createdAt
      WHERE stockId = ? AND type = 'min_stock' AND status = 'open'
      `,
      quantity,
      minStock,
      `Stock minimo alcanzado para ${stock.productName}`,
      stock.id,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    "UPDATE inventory_alerts SET status = 'resolved', resolvedAt = NOW() WHERE stockId = ? AND type = 'min_stock' AND status = 'open'",
    stock.id,
  );
}

async function insertInventoryMovement({
  productId,
  productName,
  fromStockId = null,
  toStockId = null,
  type,
  direction,
  quantity,
  unitCost = 0,
  totalCost = null,
  previousQuantity = null,
  newQuantity = null,
  referenceType = null,
  referenceId = null,
  reason = null,
  notes = null,
  authUser = null,
}) {
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO inventory_movements (
      productId, productName, fromStockId, toStockId, type, direction, quantity,
      unitCost, totalCost, previousQuantity, newQuantity, referenceType, referenceId,
      reason, notes, createdByUserId, createdByUser, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    productId,
    productName,
    fromStockId,
    toStockId,
    type,
    direction,
    Number(quantity),
    Number(unitCost || 0),
    totalCost === null || totalCost === undefined ? Number(quantity) * Number(unitCost || 0) : Number(totalCost),
    previousQuantity,
    newQuantity,
    referenceType,
    referenceId,
    reason,
    notes,
    authUser?.id || null,
    authUser?.username || null,
  );
}

async function applyInventoryEntry({ productId, quantity, unitCost, locationKey = 'global', sucursalId = null, minStock = null, referenceType = null, referenceId = null, reason = 'entrada', notes = null, authUser = null }) {
  const stock = await getOrCreateInventoryStock(productId, locationKey, sucursalId, minStock);
  if (!stock) {
    return null;
  }

  const currentQuantity = Number(stock.quantity || 0);
  const currentAverageCost = Number(stock.averageCost || 0);
  const normalizedQuantity = Number(quantity);
  const normalizedUnitCost = Number(unitCost || 0);
  const newQuantity = Number((currentQuantity + normalizedQuantity).toFixed(3));
  const averageCost =
    newQuantity > 0
      ? Number((((currentQuantity * currentAverageCost) + (normalizedQuantity * normalizedUnitCost)) / newQuantity).toFixed(2))
      : normalizedUnitCost;

  await prisma.$executeRawUnsafe(
    'UPDATE inventory_stock SET quantity = ?, averageCost = ?, lastCost = ?, updatedAt = NOW() WHERE id = ?',
    newQuantity,
    averageCost,
    normalizedUnitCost,
    stock.id,
  );

  await insertInventoryMovement({
    productId: stock.productId,
    productName: stock.productName,
    toStockId: stock.id,
    type: 'entrada',
    direction: 'in',
    quantity: normalizedQuantity,
    unitCost: normalizedUnitCost,
    previousQuantity: currentQuantity,
    newQuantity,
    referenceType,
    referenceId,
    reason,
    notes,
    authUser,
  });

  await refreshInventoryAlert(stock.id);
  return getInventoryStock(stock.id);
}

async function applyInventoryOutput({ productId, quantity, locationKey = 'global', sucursalId = null, referenceType = null, referenceId = null, reason = 'salida', notes = null, authUser = null, movementType = 'salida' }) {
  const stock = await getOrCreateInventoryStock(productId, locationKey, sucursalId);
  if (!stock) {
    return null;
  }

  const currentQuantity = Number(stock.quantity || 0);
  const normalizedQuantity = Number(quantity);
  const newQuantity = Number((currentQuantity - normalizedQuantity).toFixed(3));
  const unitCost = Number(stock.averageCost || stock.lastCost || 0);

  await prisma.$executeRawUnsafe(
    'UPDATE inventory_stock SET quantity = ?, updatedAt = NOW() WHERE id = ?',
    newQuantity,
    stock.id,
  );

  await insertInventoryMovement({
    productId: stock.productId,
    productName: stock.productName,
    fromStockId: stock.id,
    type: movementType,
    direction: 'out',
    quantity: normalizedQuantity,
    unitCost,
    previousQuantity: currentQuantity,
    newQuantity,
    referenceType,
    referenceId,
    reason,
    notes,
    authUser,
  });

  await refreshInventoryAlert(stock.id);
  return getInventoryStock(stock.id);
}

async function applyInventoryAdjustment({ productId, newQuantity, locationKey = 'global', sucursalId = null, reason = 'ajuste', notes = null, authUser = null }) {
  const stock = await getOrCreateInventoryStock(productId, locationKey, sucursalId);
  if (!stock) {
    return null;
  }

  const currentQuantity = Number(stock.quantity || 0);
  const normalizedNewQuantity = Number(newQuantity);
  const difference = Number((normalizedNewQuantity - currentQuantity).toFixed(3));
  const direction = difference >= 0 ? 'in' : 'out';
  const unitCost = Number(stock.averageCost || stock.lastCost || 0);

  await prisma.$executeRawUnsafe(
    'UPDATE inventory_stock SET quantity = ?, updatedAt = NOW() WHERE id = ?',
    normalizedNewQuantity,
    stock.id,
  );

  await insertInventoryMovement({
    productId: stock.productId,
    productName: stock.productName,
    fromStockId: direction === 'out' ? stock.id : null,
    toStockId: direction === 'in' ? stock.id : null,
    type: 'ajuste',
    direction,
    quantity: Math.abs(difference),
    unitCost,
    previousQuantity: currentQuantity,
    newQuantity: normalizedNewQuantity,
    reason,
    notes,
    authUser,
  });

  await refreshInventoryAlert(stock.id);
  return getInventoryStock(stock.id);
}

async function applyInventoryTransfer({ productId, quantity, fromLocationKey = 'global', toLocationKey, sucursalId = null, reason = 'transferencia', notes = null, authUser = null }) {
  const normalizedQuantity = Number(quantity);
  const fromStock = await getOrCreateInventoryStock(productId, fromLocationKey, sucursalId);
  const toStock = await getOrCreateInventoryStock(productId, toLocationKey, sucursalId);

  if (!fromStock || !toStock) {
    return null;
  }

  if (Number(fromStock.id) === Number(toStock.id)) {
    return { sameLocation: true };
  }

  const fromPrevious = Number(fromStock.quantity || 0);
  const toPrevious = Number(toStock.quantity || 0);
  const fromNew = Number((fromPrevious - normalizedQuantity).toFixed(3));
  const toNew = Number((toPrevious + normalizedQuantity).toFixed(3));
  const unitCost = Number(fromStock.averageCost || fromStock.lastCost || 0);

  await prisma.$executeRawUnsafe('UPDATE inventory_stock SET quantity = ?, updatedAt = NOW() WHERE id = ?', fromNew, fromStock.id);
  await prisma.$executeRawUnsafe(
    'UPDATE inventory_stock SET quantity = ?, averageCost = ?, lastCost = ?, updatedAt = NOW() WHERE id = ?',
    toNew,
    Number(toStock.averageCost || unitCost || 0),
    unitCost,
    toStock.id,
  );

  await insertInventoryMovement({
    productId: fromStock.productId,
    productName: fromStock.productName,
    fromStockId: fromStock.id,
    toStockId: toStock.id,
    type: 'transferencia',
    direction: 'transfer',
    quantity: normalizedQuantity,
    unitCost,
    previousQuantity: fromPrevious,
    newQuantity: fromNew,
    reason,
    notes,
    authUser,
  });

  await refreshInventoryAlert(fromStock.id);
  await refreshInventoryAlert(toStock.id);

  return {
    fromStock: await getInventoryStock(fromStock.id),
    toStock: await getInventoryStock(toStock.id),
  };
}

async function applyInventorySaleMovements(order, authUser) {
  for (const item of order.items || []) {
    const productId = Number(item.productId || 0);
    const quantity = Number(item.quantity || 0);

    if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    await applyInventoryOutput({
      productId,
      quantity,
      locationKey: 'global',
      sucursalId: Number(authUser?.sucursalId || 0) || null,
      referenceType: 'sale',
      referenceId: String(order.id),
      reason: 'venta',
      notes: `Venta de orden ${order.id}`,
      authUser,
      movementType: 'venta',
    });
  }
}

function normalizeEmployeeResponse(employee) {
  return {
    id: employee.id,
    empresaId: employee.empresaId === null || employee.empresaId === undefined ? null : Number(employee.empresaId),
    sucursalId: employee.sucursalId === null || employee.sucursalId === undefined ? null : Number(employee.sucursalId),
    username: employee.username,
    role: employee.role,
    name: employee.name,
    accessCode: employee.accessCode,
    isActive: employee.isActive,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

function createSecureToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getClientIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.socket?.remoteAddress || null;
}

function getUserAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 255) || null;
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function normalizeDevicePayload(req) {
  const rawDeviceId = String(req.body?.deviceId || req.headers['x-device-id'] || '').trim();
  const rawDeviceName = String(req.body?.deviceName || req.headers['x-device-name'] || '').trim();

  return {
    deviceId: rawDeviceId || `local-${crypto.randomBytes(12).toString('hex')}`,
    deviceName: rawDeviceName.slice(0, 160) || 'Dispositivo POS',
  };
}

async function tableColumnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    tableName,
    columnName,
  );
  return rows.length > 0;
}

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    LIMIT 1
    `,
    tableName,
  );
  return rows.length > 0;
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  if (!(await tableExists(tableName))) {
    return false;
  }

  if (await tableColumnExists(tableName, columnName)) {
    return true;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
  return true;
}

async function ensureIndex(tableName, indexName, indexDefinition) {
  if (!(await tableExists(tableName))) {
    return;
  }

  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    LIMIT 1
    `,
    tableName,
    indexName,
  );
  if (rows.length) {
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE \`${tableName}\` ADD ${indexDefinition}`);
}

async function getDefaultBusinessContext() {
  if (defaultBusinessContext) {
    return defaultBusinessContext;
  }

  const empresaRows = await prisma.$queryRawUnsafe(
    'SELECT id, legalName, tradeName FROM empresas WHERE taxId = ? LIMIT 1',
    defaultEmpresa.taxId,
  );
  const empresaId = Number(empresaRows[0]?.id || 0);

  if (!empresaId) {
    throw new Error('No se encontro la empresa por defecto.');
  }

  const sucursalRows = await prisma.$queryRawUnsafe(
    'SELECT id, code, name FROM sucursales WHERE empresaId = ? AND code = ? LIMIT 1',
    empresaId,
    defaultSucursal.code,
  );
  const sucursalId = Number(sucursalRows[0]?.id || 0);

  if (!sucursalId) {
    throw new Error('No se encontro la sucursal por defecto.');
  }

  defaultBusinessContext = {
    empresaId,
    sucursalId,
    empresaName: empresaRows[0].tradeName || empresaRows[0].legalName,
    sucursalName: sucursalRows[0].name,
  };
  return defaultBusinessContext;
}

function parseTenantHeader(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getRequestBusinessContext(req) {
  const fallback = await getDefaultBusinessContext();
  return {
    empresaId: parseTenantHeader(req.headers['x-empresa-id']) || Number(req.authUser?.empresaId || 0) || fallback.empresaId,
    sucursalId: parseTenantHeader(req.headers['x-sucursal-id']) || Number(req.authUser?.sucursalId || 0) || fallback.sucursalId,
  };
}

function scopedProductWhere(context, includeInactive = false) {
  return {
    ...(includeInactive ? {} : { isActive: true }),
    OR: [
      { empresaId: null, sucursalId: null },
      { empresaId: context.empresaId, sucursalId: null },
      { empresaId: context.empresaId, sucursalId: context.sucursalId },
    ],
  };
}

async function recordLoginAttempt({ employeeId = null, accessCode = null, req, success, failureReason = null }) {
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO login_attempts (employeeId, accessCode, ipAddress, userAgent, success, failureReason, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      `,
      employeeId,
      accessCode ? String(accessCode).slice(0, 32) : null,
      getClientIp(req),
      getUserAgent(req),
      success ? 1 : 0,
      failureReason,
    );
  } catch (error) {
    console.warn('[auth] No fue posible registrar intento de login:', error.message);
  }
}

async function isLoginBlocked(accessCode, req) {
  const ipAddress = getClientIp(req);
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(*) AS attempts
    FROM login_attempts
    WHERE success = 0
      AND createdAt >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
      AND (accessCode = ? OR ipAddress = ?)
    `,
    loginLockWindowMinutes,
    String(accessCode).slice(0, 32),
    ipAddress,
  );

  return Number(rows[0]?.attempts || 0) >= loginLockMaxAttempts;
}

async function upsertAuthDevice(employeeId, req) {
  const device = normalizeDevicePayload(req);
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO auth_devices (employeeId, deviceId, deviceName, userAgent, ipAddress, lastSeenAt, createdAt)
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      employeeId = VALUES(employeeId),
      deviceName = VALUES(deviceName),
      userAgent = VALUES(userAgent),
      ipAddress = VALUES(ipAddress),
      lastSeenAt = NOW()
    `,
    employeeId,
    device.deviceId,
    device.deviceName,
    getUserAgent(req),
    getClientIp(req),
  );

  const rows = await prisma.$queryRawUnsafe('SELECT id, deviceId, deviceName FROM auth_devices WHERE deviceId = ? LIMIT 1', device.deviceId);
  return rows[0] || null;
}

async function createAuthSession(user, req) {
  const now = new Date();
  const token = createSecureToken('atk');
  const refreshToken = createSecureToken('rtk');
  const expiresAt = addMinutes(now, accessTokenTtlMinutes);
  const refreshExpiresAt = addDays(now, refreshTokenTtlDays);
  const device = await upsertAuthDevice(user.id, req);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO auth_sessions (
      employeeId, deviceId, accessTokenHash, refreshTokenHash, status, ipAddress, userAgent,
      expiresAt, refreshExpiresAt, lastSeenAt, createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW(), NOW(), NOW())
    `,
    user.id,
    device?.id || null,
    hashToken(token),
    hashToken(refreshToken),
    getClientIp(req),
    getUserAgent(req),
    expiresAt,
    refreshExpiresAt,
  );

  const rows = await prisma.$queryRawUnsafe('SELECT id FROM auth_sessions WHERE accessTokenHash = ? LIMIT 1', hashToken(token));

  return {
    token,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    sessionId: Number(rows[0]?.id || 0) || null,
    device: device
      ? {
          id: Number(device.id),
          deviceId: device.deviceId,
          deviceName: device.deviceName,
        }
      : null,
  };
}

async function validateAccessSession(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      s.id AS sessionId,
      s.employeeId,
      s.status,
      s.expiresAt,
      e.id,
      e.empresaId,
      e.sucursalId,
      e.username,
      e.role,
      e.name,
      e.accessCode,
      e.isActive,
      e.createdAt,
      e.updatedAt
    FROM auth_sessions s
    INNER JOIN employees e ON e.id = s.employeeId
    WHERE s.accessTokenHash = ?
    LIMIT 1
    `,
    hashToken(token),
  );
  const row = rows[0];

  if (!row || row.status !== 'active' || !row.isActive) {
    return { ok: false, reason: 'revoked' };
  }

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await prisma.$executeRawUnsafe(
      "UPDATE auth_sessions SET status = 'expired', updatedAt = NOW() WHERE id = ? AND status = 'active'",
      row.sessionId,
    );
    return { ok: false, reason: 'expired' };
  }

  await prisma.$executeRawUnsafe('UPDATE auth_sessions SET lastSeenAt = NOW(), updatedAt = NOW() WHERE id = ?', row.sessionId);

  return {
    ok: true,
    sessionId: Number(row.sessionId),
    user: normalizeEmployeeResponse(row),
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function permissionFrom(module, action) {
  return `${String(module || '').trim()}.${String(action || '').trim()}`;
}

async function getEmployeePermissionCodes(employeeId, legacyRole) {
  if (legacyRole === 'admin') {
    return defaultPermissions.map((permission) => permission.code);
  }

  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT DISTINCT p.code
    FROM permisos p
    INNER JOIN employee_permissions ep ON ep.permissionId = p.id
    WHERE ep.employeeId = ? AND p.isActive = 1
    UNION
    SELECT DISTINCT p.code
    FROM permisos p
    INNER JOIN role_permissions rp ON rp.permissionId = p.id
    INNER JOIN roles r ON r.id = rp.roleId
    INNER JOIN employee_roles er ON er.roleId = r.id
    WHERE er.employeeId = ? AND er.isActive = 1 AND r.isActive = 1 AND p.isActive = 1
    UNION
    SELECT DISTINCT p.code
    FROM permisos p
    INNER JOIN role_permissions rp ON rp.permissionId = p.id
    INNER JOIN roles r ON r.id = rp.roleId
    WHERE r.code = ? AND r.isActive = 1 AND p.isActive = 1
    `,
    employeeId,
    employeeId,
    legacyRole,
  );

  return uniqueValues(rows.map((row) => row.code));
}

async function employeeHasPermission(employee, permissionCode) {
  if (!employee || !permissionCode) {
    return false;
  }

  if (employee.role === 'admin') {
    return true;
  }

  if (rolePermissionMap[employee.role]?.includes(permissionCode)) {
    return true;
  }

  const permissions = await getEmployeePermissionCodes(employee.id, employee.role);
  return permissions.includes(permissionCode);
}

function requirePermission(permissionCode, allowedRoles = ['admin']) {
  const roleGuard = requireRoles(allowedRoles);
  return async (req, res, next) => {
    roleGuard(req, res, async () => {
      try {
        const ok = await employeeHasPermission(req.authUser, permissionCode);
        if (!ok) {
          return res.status(403).json({ message: `Permiso requerido: ${permissionCode}` });
        }

        req.requiredPermission = permissionCode;
        return next();
      } catch (error) {
        return res.status(500).json({ message: 'No fue posible validar permisos granulares.', detail: error.message });
      }
    });
  };
}

function requireModuleAction(module, action, allowedRoles = ['admin']) {
  return requirePermission(permissionFrom(module, action), allowedRoles);
}

async function ensureDefaultEmployees() {
  for (const employee of defaultEmployees) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO employees (username, accessCode, role, name, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        accessCode = VALUES(accessCode),
        role = VALUES(role),
        name = VALUES(name),
        isActive = 1,
        updatedAt = NOW()
      `,
      employee.username,
      employee.accessCode,
      employee.role,
      employee.name,
    );
  }
}

async function ensureMultiCompanySchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INT NOT NULL AUTO_INCREMENT,
      legalName VARCHAR(160) NOT NULL,
      tradeName VARCHAR(160) NOT NULL,
      taxId VARCHAR(32) NULL,
      phone VARCHAR(32) NULL,
      email VARCHAR(120) NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_empresas_isActive (isActive),
      KEY idx_empresas_taxId (taxId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sucursales (
      id INT NOT NULL AUTO_INCREMENT,
      empresaId INT NOT NULL,
      code VARCHAR(32) NOT NULL,
      name VARCHAR(120) NOT NULL,
      address VARCHAR(255) NULL,
      phone VARCHAR(32) NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_sucursales_empresa_code (empresaId, code),
      KEY idx_sucursales_empresa_active (empresaId, isActive),
      CONSTRAINT fk_sucursales_empresa FOREIGN KEY (empresaId) REFERENCES empresas(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO empresas (legalName, tradeName, taxId, isActive, createdAt, updatedAt)
    SELECT ?, ?, ?, 1, NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE taxId = ?)
    `,
    defaultEmpresa.legalName,
    defaultEmpresa.tradeName,
    defaultEmpresa.taxId,
    defaultEmpresa.taxId,
  );

  const empresaRows = await prisma.$queryRawUnsafe('SELECT id FROM empresas WHERE taxId = ? LIMIT 1', defaultEmpresa.taxId);
  const empresaId = Number(empresaRows[0]?.id || 0);
  if (!empresaId) {
    throw new Error('No fue posible preparar empresa por defecto.');
  }

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO sucursales (empresaId, code, name, isActive, createdAt, updatedAt)
    SELECT ?, ?, ?, 1, NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM sucursales WHERE empresaId = ? AND code = ?)
    `,
    empresaId,
    defaultSucursal.code,
    defaultSucursal.name,
    empresaId,
    defaultSucursal.code,
  );

  const sucursalRows = await prisma.$queryRawUnsafe(
    'SELECT id FROM sucursales WHERE empresaId = ? AND code = ? LIMIT 1',
    empresaId,
    defaultSucursal.code,
  );
  const sucursalId = Number(sucursalRows[0]?.id || 0);
  if (!sucursalId) {
    throw new Error('No fue posible preparar sucursal por defecto.');
  }

  const tenantTables = [
    { table: 'products', empresaIndex: 'idx_products_empresa_active', sucursalIndex: 'idx_products_sucursal_active' },
    { table: 'employees', empresaIndex: 'idx_employees_empresa_role_active', sucursalIndex: 'idx_employees_sucursal_role_active' },
    { table: 'sales', empresaIndex: 'idx_sales_empresa_paidDay', sucursalIndex: 'idx_sales_sucursal_paidDay' },
    { table: 'table_accounts', empresaIndex: 'idx_table_accounts_empresa_status', sucursalIndex: 'idx_table_accounts_sucursal_status' },
    { table: 'daily_cuts', empresaIndex: 'idx_daily_cuts_empresa_cutDate', sucursalIndex: 'idx_daily_cuts_sucursal_cutDate' },
  ];

  for (const item of tenantTables) {
    if (!(await tableExists(item.table))) {
      continue;
    }

    await ensureColumn(item.table, 'empresaId', 'empresaId INT NULL');
    await ensureColumn(item.table, 'sucursalId', 'sucursalId INT NULL');
    await ensureIndex(item.table, item.empresaIndex, `KEY ${item.empresaIndex} (empresaId)`);
    await ensureIndex(item.table, item.sucursalIndex, `KEY ${item.sucursalIndex} (sucursalId)`);
    await prisma.$executeRawUnsafe(
      `UPDATE \`${item.table}\` SET empresaId = ?, sucursalId = ? WHERE empresaId IS NULL OR sucursalId IS NULL`,
      empresaId,
      sucursalId,
    );
  }

  if (await tableColumnExists('inventory_stock', 'sucursalId')) {
    await prisma.$executeRawUnsafe('UPDATE inventory_stock SET sucursalId = ? WHERE sucursalId IS NULL', sucursalId);
  }

  defaultBusinessContext = {
    empresaId,
    sucursalId,
    empresaName: defaultEmpresa.tradeName,
    sucursalName: defaultSucursal.name,
  };
}

async function ensureTableAccountsSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS table_accounts (
      id INT NOT NULL AUTO_INCREMENT,
      tableNumber INT NOT NULL,
      guestCount INT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      updatedBy VARCHAR(80) NULL,
      updatedByUserId INT NULL,
      lastOrderId INT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_table_accounts_tableNumber (tableNumber)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS table_account_items (
      id INT NOT NULL AUTO_INCREMENT,
      accountId INT NOT NULL,
      productId INT NOT NULL,
      productName VARCHAR(120) NOT NULL,
      unitPrice DECIMAL(10, 2) NOT NULL,
      quantity INT NOT NULL,
      notes VARCHAR(255) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_table_account_items_accountId (accountId),
      CONSTRAINT fk_table_account_items_account FOREIGN KEY (accountId) REFERENCES table_accounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureDailyCutsSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS daily_cuts (
      id INT NOT NULL AUTO_INCREMENT,
      reference VARCHAR(64) NOT NULL,
      cutDate DATE NOT NULL,
      ordersCount INT NOT NULL DEFAULT 0,
      revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
      generatedBy VARCHAR(80) NOT NULL,
      generatedByUserId INT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_daily_cuts_reference (reference)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureSalesCutReferenceColumn() {
  const columns = await prisma.$queryRawUnsafe(
    "SHOW COLUMNS FROM sales LIKE 'cutReference'",
  );

  if (!columns.length) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE sales
      ADD COLUMN cutReference VARCHAR(64) NULL,
      ADD KEY idx_sales_cutReference (cutReference)
    `);
  }
}

async function ensureAuthSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_devices (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NULL,
      deviceId VARCHAR(80) NOT NULL,
      deviceName VARCHAR(160) NULL,
      userAgent VARCHAR(255) NULL,
      ipAddress VARCHAR(64) NULL,
      lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_auth_devices_deviceId (deviceId),
      KEY idx_auth_devices_employeeId (employeeId),
      KEY idx_auth_devices_lastSeenAt (lastSeenAt),
      CONSTRAINT fk_auth_devices_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NOT NULL,
      deviceId INT NULL,
      accessTokenHash VARCHAR(128) NOT NULL,
      refreshTokenHash VARCHAR(128) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      ipAddress VARCHAR(64) NULL,
      userAgent VARCHAR(255) NULL,
      expiresAt DATETIME NOT NULL,
      refreshExpiresAt DATETIME NOT NULL,
      lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revokedAt DATETIME NULL,
      revokedByUserId INT NULL,
      revokedReason VARCHAR(160) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_auth_sessions_accessTokenHash (accessTokenHash),
      UNIQUE KEY uniq_auth_sessions_refreshTokenHash (refreshTokenHash),
      KEY idx_auth_sessions_employee_status (employeeId, status),
      KEY idx_auth_sessions_deviceId (deviceId),
      KEY idx_auth_sessions_expiresAt (expiresAt),
      KEY idx_auth_sessions_refreshExpiresAt (refreshExpiresAt),
      CONSTRAINT fk_auth_sessions_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE,
      CONSTRAINT fk_auth_sessions_device FOREIGN KEY (deviceId) REFERENCES auth_devices(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NULL,
      accessCode VARCHAR(32) NULL,
      ipAddress VARCHAR(64) NULL,
      userAgent VARCHAR(255) NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      failureReason VARCHAR(160) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_login_attempts_employee_createdAt (employeeId, createdAt),
      KEY idx_login_attempts_accessCode_createdAt (accessCode, createdAt),
      KEY idx_login_attempts_ip_createdAt (ipAddress, createdAt),
      CONSTRAINT fk_login_attempts_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NOT NULL,
      tokenHash VARCHAR(128) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME NULL,
      requestedIp VARCHAR(64) NULL,
      userAgent VARCHAR(255) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_password_reset_tokens_tokenHash (tokenHash),
      KEY idx_password_reset_tokens_employee_status (employeeId, status),
      KEY idx_password_reset_tokens_expiresAt (expiresAt),
      CONSTRAINT fk_password_reset_tokens_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureAuthorizationSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS permisos (
      id INT NOT NULL AUTO_INCREMENT,
      code VARCHAR(120) NOT NULL,
      name VARCHAR(120) NOT NULL,
      module VARCHAR(80) NOT NULL,
      action VARCHAR(80) NOT NULL,
      description VARCHAR(255) NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_permisos_code (code),
      KEY idx_permisos_module_action (module, action),
      KEY idx_permisos_isActive (isActive)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT NOT NULL AUTO_INCREMENT,
      code VARCHAR(80) NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(255) NULL,
      isSystem TINYINT(1) NOT NULL DEFAULT 0,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_roles_code (code),
      KEY idx_roles_isActive (isActive)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INT NOT NULL AUTO_INCREMENT,
      roleId INT NOT NULL,
      permissionId INT NOT NULL,
      grantedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_role_permissions_role_permission (roleId, permissionId),
      KEY idx_role_permissions_permissionId (permissionId),
      CONSTRAINT fk_role_permissions_role FOREIGN KEY (roleId) REFERENCES roles(id) ON DELETE CASCADE,
      CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permissionId) REFERENCES permisos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS employee_roles (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NOT NULL,
      roleId INT NOT NULL,
      scopeType VARCHAR(24) NOT NULL DEFAULT 'global',
      empresaId INT NULL,
      sucursalId INT NULL,
      grantedByEmployeeId INT NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_employee_role_scope (employeeId, roleId, scopeType, empresaId, sucursalId),
      KEY idx_employee_roles_roleId (roleId),
      KEY idx_employee_roles_empresaId (empresaId),
      KEY idx_employee_roles_sucursalId (sucursalId),
      KEY idx_employee_roles_grantedByEmployeeId (grantedByEmployeeId),
      KEY idx_employee_roles_isActive (isActive),
      CONSTRAINT fk_employee_roles_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_roles_role FOREIGN KEY (roleId) REFERENCES roles(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_roles_empresa FOREIGN KEY (empresaId) REFERENCES empresas(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_roles_sucursal FOREIGN KEY (sucursalId) REFERENCES sucursales(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_roles_granted_by FOREIGN KEY (grantedByEmployeeId) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS employee_permissions (
      id INT NOT NULL AUTO_INCREMENT,
      employeeId INT NOT NULL,
      permissionId INT NOT NULL,
      scopeType VARCHAR(24) NOT NULL DEFAULT 'global',
      empresaId INT NULL,
      sucursalId INT NULL,
      grantedByEmployeeId INT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_employee_permission_scope (employeeId, permissionId, scopeType, empresaId, sucursalId),
      KEY idx_employee_permissions_permissionId (permissionId),
      KEY idx_employee_permissions_empresaId (empresaId),
      KEY idx_employee_permissions_sucursalId (sucursalId),
      KEY idx_employee_permissions_grantedByEmployeeId (grantedByEmployeeId),
      CONSTRAINT fk_employee_permissions_employee FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_permissions_permission FOREIGN KEY (permissionId) REFERENCES permisos(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_permissions_empresa FOREIGN KEY (empresaId) REFERENCES empresas(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_permissions_sucursal FOREIGN KEY (sucursalId) REFERENCES sucursales(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_permissions_granted_by FOREIGN KEY (grantedByEmployeeId) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureInventorySchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS inventory_stock (
      id INT NOT NULL AUTO_INCREMENT,
      productId INT NULL,
      productName VARCHAR(160) NOT NULL,
      sucursalId INT NULL,
      locationKey VARCHAR(80) NOT NULL DEFAULT 'global',
      quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
      averageCost DECIMAL(12, 2) NOT NULL DEFAULT 0,
      lastCost DECIMAL(12, 2) NOT NULL DEFAULT 0,
      minStock DECIMAL(12, 3) NOT NULL DEFAULT 0,
      isActive BOOLEAN NOT NULL DEFAULT true,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY inventory_stock_product_location_unique (productId, locationKey),
      INDEX inventory_stock_product_idx (productId),
      INDEX inventory_stock_sucursal_idx (sucursalId),
      INDEX inventory_stock_location_idx (locationKey),
      INDEX inventory_stock_quantity_idx (quantity),
      INDEX inventory_stock_min_stock_idx (minStock),
      CONSTRAINT inventory_stock_product_fk FOREIGN KEY (productId) REFERENCES products(id) ON DELETE SET NULL,
      CONSTRAINT inventory_stock_sucursal_fk FOREIGN KEY (sucursalId) REFERENCES sucursales(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INT NOT NULL AUTO_INCREMENT,
      productId INT NULL,
      productName VARCHAR(160) NOT NULL,
      fromStockId INT NULL,
      toStockId INT NULL,
      type VARCHAR(32) NOT NULL,
      direction VARCHAR(24) NOT NULL,
      quantity DECIMAL(12, 3) NOT NULL,
      unitCost DECIMAL(12, 2) NOT NULL DEFAULT 0,
      totalCost DECIMAL(12, 2) NOT NULL DEFAULT 0,
      previousQuantity DECIMAL(12, 3) NULL,
      newQuantity DECIMAL(12, 3) NULL,
      referenceType VARCHAR(40) NULL,
      referenceId VARCHAR(80) NULL,
      reason VARCHAR(160) NULL,
      notes VARCHAR(255) NULL,
      createdByUserId INT NULL,
      createdByUser VARCHAR(80) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX inventory_movements_product_created_idx (productId, createdAt),
      INDEX inventory_movements_type_created_idx (type, createdAt),
      INDEX inventory_movements_reference_idx (referenceType, referenceId),
      INDEX inventory_movements_from_stock_idx (fromStockId),
      INDEX inventory_movements_to_stock_idx (toStockId),
      INDEX inventory_movements_user_created_idx (createdByUserId, createdAt),
      CONSTRAINT inventory_movements_product_fk FOREIGN KEY (productId) REFERENCES products(id) ON DELETE SET NULL,
      CONSTRAINT inventory_movements_from_stock_fk FOREIGN KEY (fromStockId) REFERENCES inventory_stock(id) ON DELETE SET NULL,
      CONSTRAINT inventory_movements_to_stock_fk FOREIGN KEY (toStockId) REFERENCES inventory_stock(id) ON DELETE SET NULL,
      CONSTRAINT inventory_movements_employee_fk FOREIGN KEY (createdByUserId) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS inventory_alerts (
      id INT NOT NULL AUTO_INCREMENT,
      stockId INT NOT NULL,
      productId INT NULL,
      type VARCHAR(32) NOT NULL DEFAULT 'min_stock',
      status VARCHAR(24) NOT NULL DEFAULT 'open',
      threshold DECIMAL(12, 3) NOT NULL,
      currentQuantity DECIMAL(12, 3) NOT NULL,
      message VARCHAR(255) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolvedAt DATETIME NULL,
      PRIMARY KEY (id),
      INDEX inventory_alerts_stock_status_idx (stockId, status),
      INDEX inventory_alerts_product_status_idx (productId, status),
      INDEX inventory_alerts_type_status_idx (type, status),
      INDEX inventory_alerts_created_idx (createdAt),
      CONSTRAINT inventory_alerts_stock_fk FOREIGN KEY (stockId) REFERENCES inventory_stock(id) ON DELETE CASCADE,
      CONSTRAINT inventory_alerts_product_fk FOREIGN KEY (productId) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function seedAuthorizationCatalog() {
  for (const role of defaultRoles) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO roles (code, name, description, isSystem, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        description = VALUES(description),
        isSystem = VALUES(isSystem),
        isActive = 1,
        updatedAt = NOW()
      `,
      role.code,
      role.name,
      role.description,
      role.isSystem ? 1 : 0,
    );
  }

  for (const permission of defaultPermissions) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO permisos (code, name, module, action, description, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        module = VALUES(module),
        action = VALUES(action),
        description = VALUES(description),
        isActive = 1,
        updatedAt = NOW()
      `,
      permission.code,
      permission.name,
      permission.module,
      permission.action,
      permission.description || null,
    );
  }

  for (const [roleCode, permissionCodes] of Object.entries(rolePermissionMap)) {
    const roleRows = await prisma.$queryRawUnsafe('SELECT id FROM roles WHERE code = ? LIMIT 1', roleCode);
    const roleId = Number(roleRows[0]?.id || 0);
    if (!roleId) {
      continue;
    }

    for (const permissionCode of permissionCodes) {
      const permissionRows = await prisma.$queryRawUnsafe('SELECT id FROM permisos WHERE code = ? LIMIT 1', permissionCode);
      const permissionId = Number(permissionRows[0]?.id || 0);
      if (!permissionId) {
        continue;
      }

      await prisma.$executeRawUnsafe(
        `
        INSERT IGNORE INTO role_permissions (roleId, permissionId, grantedAt)
        VALUES (?, ?, NOW())
        `,
        roleId,
        permissionId,
      );
    }
  }

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO employee_roles (employeeId, roleId, scopeType, isActive, createdAt)
    SELECT e.id, r.id, 'global', 1, NOW()
    FROM employees e
    INNER JOIN roles r ON r.code = e.role
    WHERE e.isActive = 1
      AND NOT EXISTS (
        SELECT 1
        FROM employee_roles er
        WHERE er.employeeId = e.id
          AND er.roleId = r.id
          AND er.scopeType = 'global'
          AND er.empresaId IS NULL
          AND er.sucursalId IS NULL
      )
    `,
  );
}

function buildCutReference(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `CUT-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function initializeOrderSequenceFromSales() {
  const rows = await prisma.$queryRawUnsafe('SELECT COALESCE(MAX(orderId), 0) AS maxOrderId FROM sales');
  const maxOrderId = Number(rows[0]?.maxOrderId || 0);

  if (Number.isInteger(maxOrderId) && maxOrderId >= orderSequence) {
    orderSequence = maxOrderId + 1;
  }
}

async function getTableAccountByNumber(tableNumber, context = null) {
  const scope = context || (await getDefaultBusinessContext());
  const accountRows = await prisma.$queryRawUnsafe(
    'SELECT id, empresaId, sucursalId, tableNumber, guestCount, status, updatedBy, updatedByUserId, lastOrderId, createdAt, updatedAt FROM table_accounts WHERE tableNumber = ? AND (sucursalId IS NULL OR sucursalId = ?) LIMIT 1',
    tableNumber,
    scope.sucursalId,
  );
  const account = accountRows[0];

  if (!account || account.status !== 'open') {
    return null;
  }

  const itemRows = await prisma.$queryRawUnsafe(
    'SELECT id, productId, productName, unitPrice, quantity, notes FROM table_account_items WHERE accountId = ? ORDER BY id ASC',
    account.id,
  );

  return {
    id: account.id,
    empresaId: account.empresaId === null ? null : Number(account.empresaId),
    sucursalId: account.sucursalId === null ? null : Number(account.sucursalId),
    tableNumber: Number(account.tableNumber),
    guestCount: account.guestCount === null ? null : Number(account.guestCount),
    updatedBy: account.updatedBy || null,
    updatedByUserId: account.updatedByUserId === null ? null : Number(account.updatedByUserId),
    lastOrderId: account.lastOrderId === null ? null : Number(account.lastOrderId),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    items: itemRows.map((item) => ({
      id: Number(item.id),
      productId: Number(item.productId),
      productName: item.productName,
      unitPrice: Number(item.unitPrice),
      quantity: Number(item.quantity),
      notes: item.notes || '',
      subtotal: Number((Number(item.unitPrice) * Number(item.quantity)).toFixed(2)),
    })),
  };
}

async function getOpenTableAccounts(context = null) {
  const scope = context || (await getDefaultBusinessContext());
  const accounts = await prisma.$queryRawUnsafe(
    "SELECT id, empresaId, sucursalId, tableNumber, guestCount, status, updatedBy, updatedByUserId, lastOrderId, createdAt, updatedAt FROM table_accounts WHERE status = 'open' AND (sucursalId IS NULL OR sucursalId = ?) ORDER BY tableNumber ASC",
    scope.sucursalId,
  );

  if (!accounts.length) {
    return [];
  }

  const accountIds = accounts.map((account) => Number(account.id));
  const placeholders = accountIds.map(() => '?').join(', ');
  const items = await prisma.$queryRawUnsafe(
    `SELECT id, accountId, productId, productName, unitPrice, quantity, notes FROM table_account_items WHERE accountId IN (${placeholders}) ORDER BY accountId ASC, id ASC`,
    ...accountIds,
  );

  const itemsByAccount = new Map();
  for (const item of items) {
    const key = Number(item.accountId);
    if (!itemsByAccount.has(key)) {
      itemsByAccount.set(key, []);
    }
    itemsByAccount.get(key).push({
      id: Number(item.id),
      productId: Number(item.productId),
      productName: item.productName,
      unitPrice: Number(item.unitPrice),
      quantity: Number(item.quantity),
      notes: item.notes || '',
      subtotal: Number((Number(item.unitPrice) * Number(item.quantity)).toFixed(2)),
    });
  }

  return accounts.map((account) => ({
    id: Number(account.id),
    empresaId: account.empresaId === null ? null : Number(account.empresaId),
    sucursalId: account.sucursalId === null ? null : Number(account.sucursalId),
    tableNumber: Number(account.tableNumber),
    guestCount: account.guestCount === null ? null : Number(account.guestCount),
    updatedBy: account.updatedBy || null,
    updatedByUserId: account.updatedByUserId === null ? null : Number(account.updatedByUserId),
    lastOrderId: account.lastOrderId === null ? null : Number(account.lastOrderId),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    items: itemsByAccount.get(Number(account.id)) || [],
  }));
}

async function closeTableAccountByNumber(tableNumber, authUser) {
  const context = await getDefaultBusinessContext();
  const rows = await prisma.$queryRawUnsafe('SELECT id FROM table_accounts WHERE tableNumber = ? AND (sucursalId IS NULL OR sucursalId = ?) LIMIT 1', tableNumber, Number(authUser?.sucursalId || 0) || context.sucursalId);
  const accountId = Number(rows[0]?.id || 0);

  if (!accountId) {
    return false;
  }

  await prisma.$executeRawUnsafe('DELETE FROM table_account_items WHERE accountId = ?', accountId);
  await prisma.$executeRawUnsafe(
    "UPDATE table_accounts SET status = 'closed', guestCount = NULL, updatedBy = ?, updatedByUserId = ?, lastOrderId = NULL, updatedAt = NOW() WHERE id = ?",
    authUser?.username || 'sistema-local',
    Number(authUser?.id || 0) || null,
    accountId,
  );

  return true;
}

function buildOrderFromTableAccount(account, authUser, paymentInput) {
  const paidAt = new Date().toISOString();
  const empresaId = Number(authUser?.empresaId || account.empresaId || 0) || null;
  const sucursalId = Number(authUser?.sucursalId || account.sucursalId || 0) || null;
  const items = account.items.map((item) => ({
    productId: Number(item.productId),
    productName: item.productName,
    unitPrice: Number(item.unitPrice),
    quantity: Number(item.quantity),
    notes: item.notes || '',
    subtotal: Number((Number(item.unitPrice) * Number(item.quantity)).toFixed(2)),
  }));
  const total = Number(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0).toFixed(2));
  const amountReceived = Number(paymentInput.amountReceived);

  const order = {
    id: orderSequence,
    empresaId,
    sucursalId,
    status: 'pagada',
    createdBy: authUser?.username || account.updatedBy || 'sistema-local',
    createdByUserId: Number(authUser?.id || account.updatedByUserId || 0) || null,
    createdByRole: authUser?.role || null,
    createdAt: paidAt,
    updatedAt: paidAt,
    items,
    total,
    table: {
      number: Number(account.tableNumber),
      guestCount: Number(account.guestCount || 0) || null,
    },
    metrics: {
      createdAt: account.createdAt || paidAt,
      sentToKitchenAt: null,
      readyAt: null,
      deliveredAt: null,
    },
    payment: {
      paid: true,
      paidAt,
      method: paymentInput.method,
      amountReceived: Number(amountReceived.toFixed(2)),
      change: Number((amountReceived - total).toFixed(2)),
    },
  };

  orderSequence += 1;
  orders.push(order);
  return order;
}

async function persistPaidSale(order) {
  const paidDay = String(order.payment.paidAt).slice(0, 10);
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO sales (empresaId, sucursalId, orderId, paidDay, total, paymentMethod, amountReceived, \`change\`, createdByUser, itemCount, paidAt, cutReference, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW())
    ON DUPLICATE KEY UPDATE
      empresaId = VALUES(empresaId),
      sucursalId = VALUES(sucursalId),
      paidDay = VALUES(paidDay),
      total = VALUES(total),
      paymentMethod = VALUES(paymentMethod),
      amountReceived = VALUES(amountReceived),
      \`change\` = VALUES(\`change\`),
      createdByUser = VALUES(createdByUser),
      itemCount = VALUES(itemCount),
      paidAt = VALUES(paidAt),
      cutReference = NULL
    `,
    Number(order.empresaId || 0) || null,
    Number(order.sucursalId || 0) || null,
    order.id,
    paidDay,
    Number(order.total),
    order.payment.method,
    Number(order.payment.amountReceived),
    Number(order.payment.change),
    order.createdBy,
    order.items.length,
    new Date(order.payment.paidAt),
  );
}

async function buildCashierPrintResult(order) {
  try {
    return await printToGroup('cashier', buildCashierTicket(order));
  } catch (error) {
    console.warn('[printing] No fue posible imprimir ticket de caja:', error.message);
    return {
      enabled: printingEnabled,
      groupName: 'cashier',
      okCount: 0,
      failCount: cashierPrinters.length,
      results: cashierPrinters.map((target) => ({ ok: false, target, error: error.message })),
    };
  }
}

function queueCashierPrint(order) {
  const queuedAt = new Date().toISOString();

  setImmediate(() => {
    buildCashierPrintResult(order)
      .then((result) => {
        recordTelemetry(order.id, 'CASHIER_TICKET_PRINTED', {
          queuedAt,
          okCount: Number(result.okCount || 0),
          failCount: Number(result.failCount || 0),
          enabled: Boolean(result.enabled),
        });
      })
      .catch((error) => {
        console.warn('[printing] No fue posible procesar ticket en segundo plano:', error.message);
        recordTelemetry(order.id, 'CASHIER_TICKET_PRINT_FAILED', {
          queuedAt,
          error: error.message,
        });
      });
  });

  return {
    enabled: printingEnabled,
    groupName: 'cashier',
    queued: true,
    queuedAt,
    okCount: 0,
    failCount: 0,
    message: printingEnabled
      ? 'Ticket enviado a impresion en segundo plano.'
      : 'Impresion desactivada por configuracion (PRINTING_ENABLED=false).',
    results: [],
  };
}

async function finalizePaidOrder(order, authUser) {
  await persistPaidSale(order);

  const inventoryWarnings = [];
  try {
    await applyInventorySaleMovements(order, authUser);
  } catch (error) {
    console.warn('[inventory] No fue posible registrar salida por venta:', error.message);
    inventoryWarnings.push('Pago registrado, pero inventario no pudo actualizarse automaticamente.');
  }

  const cashierPrint = queueCashierPrint(order);
  const paidTableNumber = Number(order?.table?.number || 0);

  if (Number.isInteger(paidTableNumber) && paidTableNumber > 0) {
    const siblingOrders = orders.filter(
      (item) =>
        Number(item.id) !== Number(order.id) &&
        Number(item?.table?.number || 0) === paidTableNumber &&
        !item?.payment?.paid,
    );

    for (const sibling of siblingOrders) {
      sibling.payment = {
        paid: true,
        paidAt: order.payment.paidAt,
        method: 'consolidado',
        amountReceived: 0,
        change: 0,
      };
      sibling.status = 'cerrada';
      sibling.updatedAt = new Date().toISOString();
      recordTelemetry(sibling.id, 'ORDER_CLOSED_BY_TABLE_PAYMENT', { paidByOrderId: order.id, tableNumber: paidTableNumber });
    }

    try {
      await closeTableAccountByNumber(paidTableNumber, authUser);
    } catch (error) {
      console.warn('[table-account] No fue posible cerrar cuenta de mesa tras pago:', error.message);
    }
  }

  return { cashierPrint, inventoryWarnings };
}

function getRequestUser(req) {
  const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
  const id = Number(req.headers['x-user-id']);

  if (!Number.isInteger(id) || !role) {
    return null;
  }

  return { id, role };
}

async function validateLegacyRequestUser(req, allowedRoles) {
  const user = getRequestUser(req);
  if (!user || !allowedRoles.includes(user.role)) {
    return { ok: false, status: 403, message: `Acceso denegado. Roles permitidos: ${allowedRoles.join(', ')}` };
  }

  const rows = await prisma.$queryRawUnsafe(
    'SELECT id, empresaId, sucursalId, username, role, name, accessCode, isActive, createdAt, updatedAt FROM employees WHERE id = ? LIMIT 1',
    user.id,
  );
  const dbUser = rows[0];

  if (!dbUser || !dbUser.isActive || dbUser.role !== user.role || !allowedRoles.includes(dbUser.role)) {
    return { ok: false, status: 403, message: `Acceso denegado. Roles permitidos: ${allowedRoles.join(', ')}` };
  }

  return { ok: true, user: normalizeEmployeeResponse(dbUser) };
}

function requireRoles(allowedRoles) {
  return async (req, res, next) => {
    const sessionValidation = await validateAccessSession(req);
    if (sessionValidation.ok) {
      if (!allowedRoles.includes(sessionValidation.user.role)) {
        try {
          const legacyValidation = await validateLegacyRequestUser(req, allowedRoles);
          if (legacyValidation.ok) {
            req.authUser = legacyValidation.user;
            req.authSessionId = null;
            return next();
          }
        } catch (error) {
          return res.status(500).json({ message: 'No fue posible validar permisos.', detail: error.message });
        }

        return res.status(403).json({ message: `Acceso denegado. Roles permitidos: ${allowedRoles.join(', ')}` });
      }

      req.authUser = sessionValidation.user;
      req.authSessionId = sessionValidation.sessionId;
      return next();
    }

    if (sessionValidation.reason && sessionValidation.reason !== 'missing') {
      try {
        const legacyValidation = await validateLegacyRequestUser(req, allowedRoles);
        if (legacyValidation.ok) {
          req.authUser = legacyValidation.user;
          req.authSessionId = null;
          return next();
        }
      } catch (error) {
        return res.status(500).json({ message: 'No fue posible validar permisos.', detail: error.message });
      }

      return res.status(401).json({ message: 'Sesion vencida o cerrada. Inicia sesion nuevamente.' });
    }

    try {
      const legacyValidation = await validateLegacyRequestUser(req, allowedRoles);
      if (!legacyValidation.ok) {
        return res.status(legacyValidation.status).json({ message: legacyValidation.message });
      }

      req.authUser = legacyValidation.user;
      return next();
    } catch (error) {
      return res.status(500).json({ message: 'No fue posible validar permisos.', detail: error.message });
    }
  };
}

const requireAdmin = requirePermission('security.permissions.manage', ['admin']);
const requireSecurityRead = requirePermission('security.permissions.read', ['admin']);
const requireProductManage = requirePermission('admin.products.manage', ['admin']);
const requireEmployeeManage = requirePermission('admin.employees.manage', ['admin']);
const requireSalesRead = requirePermission('admin.sales.read', ['admin']);
const requireSalesCutoff = requirePermission('admin.sales.cutoff', ['admin']);
const requireBusinessManage = requirePermission('admin.business.manage', ['admin']);
const requireOrderRead = requirePermission('orders.read', ['admin', 'cashier', 'waiter', 'kitchen']);
const requireOrderCreate = requirePermission('orders.create', ['waiter', 'cashier', 'admin']);
const requireOrderStatusUpdate = requirePermission('orders.status.update', ['waiter', 'cashier', 'admin', 'kitchen']);
const requireOrderPay = requirePermission('orders.pay', ['cashier', 'admin']);
const requireKitchenPrint = requirePermission('orders.print.kitchen', ['waiter', 'cashier', 'admin']);
const requireCustomerPrint = requirePermission('orders.print.customer', ['waiter', 'cashier', 'admin']);
const requireTableRead = requirePermission('tables.read', ['waiter', 'cashier', 'admin']);
const requireTableManage = requirePermission('tables.manage', ['waiter', 'cashier', 'admin']);
const requireTableClose = requirePermission('tables.manage', ['cashier', 'admin']);
const requireSessionRead = requirePermission('auth.sessions.read', ['admin', 'cashier', 'waiter', 'kitchen']);
const requireSessionRevoke = requirePermission('auth.sessions.revoke', ['admin', 'cashier', 'waiter', 'kitchen']);
const requireInventoryRead = requirePermission('inventory.read', ['admin', 'cashier']);
const requireInventoryMovementCreate = requirePermission('inventory.movements.create', ['admin']);
const requireInventoryAdjust = requirePermission('inventory.adjust', ['admin']);
const requireInventoryTransfer = requirePermission('inventory.transfer', ['admin']);
const requireInventoryAlertsRead = requirePermission('inventory.alerts.read', ['admin', 'cashier']);

function parsePrinterTargets(rawTargets) {
  return String(rawTargets)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target) => {
      const [host, portRaw] = target.split(':');
      const port = Number(portRaw || 9100);
      if (!host || !Number.isInteger(port) || port <= 0) {
        return null;
      }

      return { host, port };
    })
    .filter(Boolean);
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function buildKitchenTicket(order) {
  const tableInfo = order.table?.number ? `Mesa: ${order.table.number} (${order.table.guestCount || 0} personas)` : null;
  const header = [
    'LOS PACHECOS - COCINA',
    `Orden: #${order.id}`,
    `Creada por: ${order.createdBy}`,
    ...(tableInfo ? [tableInfo] : []),
    `Hora: ${new Date().toLocaleString('es-MX')}`,
    '------------------------------',
  ];

  const lines = order.items.map((item) => `${item.quantity}x ${item.productName}`);
  const footer = ['------------------------------', 'FIN COMANDA', '\n\n\n'];

  return [...header, ...lines, ...footer].join('\n');
}

function buildCashierTicket(order) {
  const tableInfo = order.table?.number ? `Mesa: ${order.table.number} (${order.table.guestCount || 0} personas)` : null;
  const header = [
    'LOS PACHECOS',
    'TICKET DE PAGO',
    `Orden: #${order.id}`,
    `Atendido por: ${order.createdBy}`,
    ...(tableInfo ? [tableInfo] : []),
    `Fecha: ${new Date().toLocaleString('es-MX')}`,
    '------------------------------',
  ];

  const lines = order.items.map(
    (item) => `${item.quantity}x ${item.productName}  ${formatMoney(item.subtotal)}`,
  );

  const paymentLines = [
    '------------------------------',
    `Total: ${formatMoney(order.total)}`,
    `Metodo: ${order.payment.method || 'efectivo'}`,
    `Recibido: ${formatMoney(order.payment.amountReceived || order.total)}`,
    `Cambio: ${formatMoney(order.payment.change || 0)}`,
    'Gracias por su compra',
    '\n\n\n',
  ];

  return [...header, ...lines, ...paymentLines].join('\n');
}

function buildCustomerPrecheckTicket(order) {
  const tableInfo = order.table?.number ? `Mesa: ${order.table.number} (${order.table.guestCount || 0} personas)` : null;
  const header = [
    'LOS PACHECOS',
    'PRECUENTA',
    `Orden: #${order.id}`,
    `Atendido por: ${order.createdBy}`,
    ...(tableInfo ? [tableInfo] : []),
    `Fecha: ${new Date().toLocaleString('es-MX')}`,
    '------------------------------',
  ];

  const lines = order.items.map(
    (item) => `${item.quantity}x ${item.productName}  ${formatMoney(item.subtotal)}`,
  );

  const footer = [
    '------------------------------',
    `Total: ${formatMoney(order.total)}`,
    'Este ticket no representa pago',
    '\n\n\n',
  ];

  return [...header, ...lines, ...footer].join('\n');
}

function sendRawToPrinter(target, content) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    function done(result) {
      if (finished) {
        return;
      }

      finished = true;
      try {
        socket.destroy();
      } catch (error) {
        // No action needed.
      }
      resolve(result);
    }

    socket.setTimeout(1200);
    socket.once('error', (error) => done({ ok: false, target, error: error.message }));
    socket.once('timeout', () => done({ ok: false, target, error: 'Timeout de conexion con impresora.' }));

    socket.connect(target.port, target.host, () => {
      socket.write(content, 'utf8', () => {
        done({ ok: true, target });
      });
    });
  });
}

async function printToGroup(groupName, content) {
  if (!printingEnabled) {
    return {
      enabled: false,
      message: 'Impresion desactivada por configuracion (PRINTING_ENABLED=false).',
      results: [],
    };
  }

  const targets = groupName === 'kitchen' ? kitchenPrinters : cashierPrinters;
  if (!targets.length) {
    return {
      enabled: false,
      message: `No hay impresoras configuradas para ${groupName}.`,
      results: [],
    };
  }

  const results = await Promise.all(targets.map((target) => sendRawToPrinter(target, content)));
  const okCount = results.filter((result) => result.ok).length;
  return {
    enabled: true,
    groupName,
    okCount,
    failCount: results.length - okCount,
    results,
  };
}

// Endpoint de salud para validar que el servicio esta disponible.
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'pos-los-pachecos-backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: {
      orders: orders.length,
      telemetryEvents: telemetryEvents.length,
    },
  });
});

// Endpoint inicial de bienvenida para verificar onboarding tecnico.
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'API base de POS Los Pachecos operando correctamente.',
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { accessCode } = req.body;

  if (!accessCode) {
    return res.status(400).json({ message: 'accessCode es requerido.' });
  }

  const normalizedCode = String(accessCode).trim();
  if (!/^\d{4,8}$/.test(normalizedCode)) {
    return res.status(400).json({ message: 'accessCode debe contener solo numeros (4 a 8 digitos).' });
  }

  try {
    const blocked = await isLoginBlocked(normalizedCode, req);
    if (blocked) {
      await recordLoginAttempt({
        accessCode: normalizedCode,
        req,
        success: false,
        failureReason: 'blocked_by_attempts',
      });
      return res.status(429).json({
        message: `Demasiados intentos fallidos. Intenta de nuevo en ${loginLockWindowMinutes} minutos.`,
      });
    }
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible validar bloqueo de seguridad.', detail: error.message });
  }

  let user;
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, empresaId, sucursalId, username, role, name, accessCode, isActive, createdAt, updatedAt FROM employees WHERE accessCode = ? AND isActive = 1 LIMIT 1',
      normalizedCode,
    );
    user = rows[0];
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible validar credenciales.', detail: error.message });
  }

  if (!user) {
    await recordLoginAttempt({
      accessCode: normalizedCode,
      req,
      success: false,
      failureReason: 'invalid_credentials',
    });
    return res.status(401).json({ message: 'Credenciales invalidas.' });
  }

  await recordLoginAttempt({
    employeeId: user.id,
    accessCode: normalizedCode,
    req,
    success: true,
  });

  let session;
  try {
    session = await createAuthSession(user, req);
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible crear sesion segura.', detail: error.message });
  }

  return res.status(200).json({
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    sessionId: session.sessionId,
    device: session.device,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    },
  });
});

app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = String(req.body.refreshToken || '').trim();
  if (!refreshToken) {
    return res.status(400).json({ message: 'refreshToken es requerido.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        s.id AS sessionId,
        s.employeeId,
        s.deviceId,
        s.status,
        s.refreshExpiresAt,
        e.id,
        e.empresaId,
        e.sucursalId,
        e.username,
        e.role,
        e.name,
        e.accessCode,
        e.isActive,
        e.createdAt,
        e.updatedAt
      FROM auth_sessions s
      INNER JOIN employees e ON e.id = s.employeeId
      WHERE s.refreshTokenHash = ?
      LIMIT 1
      `,
      hashToken(refreshToken),
    );
    const session = rows[0];

    if (!session || session.status !== 'active' || !session.isActive) {
      return res.status(401).json({ message: 'Refresh token invalido.' });
    }

    if (new Date(session.refreshExpiresAt).getTime() <= Date.now()) {
      await prisma.$executeRawUnsafe(
        "UPDATE auth_sessions SET status = 'expired', updatedAt = NOW() WHERE id = ?",
        session.sessionId,
      );
      return res.status(401).json({ message: 'Refresh token vencido.' });
    }

    const now = new Date();
    const token = createSecureToken('atk');
    const nextRefreshToken = createSecureToken('rtk');
    const expiresAt = addMinutes(now, accessTokenTtlMinutes);
    const refreshExpiresAt = addDays(now, refreshTokenTtlDays);

    await prisma.$executeRawUnsafe(
      `
      UPDATE auth_sessions
      SET accessTokenHash = ?, refreshTokenHash = ?, expiresAt = ?, refreshExpiresAt = ?, lastSeenAt = NOW(), updatedAt = NOW()
      WHERE id = ?
      `,
      hashToken(token),
      hashToken(nextRefreshToken),
      expiresAt,
      refreshExpiresAt,
      session.sessionId,
    );

    return res.status(200).json({
      token,
      refreshToken: nextRefreshToken,
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      sessionId: Number(session.sessionId),
      user: {
        id: session.id,
        username: session.username,
        role: session.role,
        name: session.name,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible renovar sesion.', detail: error.message });
  }
});

app.post('/api/auth/logout', requireSessionRevoke, async (req, res) => {
  if (!req.authSessionId) {
    return res.status(200).json({ success: true, legacy: true });
  }

  try {
    await prisma.$executeRawUnsafe(
      "UPDATE auth_sessions SET status = 'revoked', revokedAt = NOW(), revokedByUserId = ?, revokedReason = 'logout', updatedAt = NOW() WHERE id = ?",
      req.authUser.id,
      req.authSessionId,
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible cerrar sesion.', detail: error.message });
  }
});

app.get('/api/auth/sessions', requireSessionRead, async (req, res) => {
  try {
    const isAdmin = req.authUser.role === 'admin';
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        s.id,
        s.employeeId,
        e.username,
        e.name,
        e.role,
        s.status,
        s.ipAddress,
        s.userAgent,
        s.expiresAt,
        s.refreshExpiresAt,
        s.lastSeenAt,
        s.createdAt,
        d.deviceId,
        d.deviceName
      FROM auth_sessions s
      INNER JOIN employees e ON e.id = s.employeeId
      LEFT JOIN auth_devices d ON d.id = s.deviceId
      WHERE (? = 1 OR s.employeeId = ?)
      ORDER BY s.lastSeenAt DESC, s.id DESC
      LIMIT 100
      `,
      isAdmin ? 1 : 0,
      req.authUser.id,
    );

    return res.status(200).json({
      sessions: rows.map((item) => ({
        id: Number(item.id),
        employeeId: Number(item.employeeId),
        username: item.username,
        name: item.name,
        role: item.role,
        status: item.status,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        expiresAt: item.expiresAt,
        refreshExpiresAt: item.refreshExpiresAt,
        lastSeenAt: item.lastSeenAt,
        createdAt: item.createdAt,
        deviceId: item.deviceId,
        deviceName: item.deviceName,
        current: Number(item.id) === Number(req.authSessionId),
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar sesiones.', detail: error.message });
  }
});

app.delete('/api/auth/sessions/:id', requireSessionRevoke, async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ message: 'ID de sesion invalido.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe('SELECT id, employeeId FROM auth_sessions WHERE id = ? LIMIT 1', sessionId);
    const session = rows[0];
    if (!session) {
      return res.status(404).json({ message: 'Sesion no encontrada.' });
    }

    const canRevoke = req.authUser.role === 'admin' || Number(session.employeeId) === Number(req.authUser.id);
    if (!canRevoke) {
      return res.status(403).json({ message: 'No puedes cerrar sesiones de otro usuario.' });
    }

    await prisma.$executeRawUnsafe(
      "UPDATE auth_sessions SET status = 'revoked', revokedAt = NOW(), revokedByUserId = ?, revokedReason = 'remote_logout', updatedAt = NOW() WHERE id = ?",
      req.authUser.id,
      sessionId,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible cerrar sesion remota.', detail: error.message });
  }
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!username) {
    return res.status(400).json({ message: 'username es requerido.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, username, isActive FROM employees WHERE username = ? AND isActive = 1 LIMIT 1',
      username,
    );
    const employee = rows[0];
    const genericMessage = 'Si el usuario existe, se genero una solicitud de recuperacion.';

    if (!employee) {
      return res.status(200).json({ message: genericMessage });
    }

    await prisma.$executeRawUnsafe(
      "UPDATE password_reset_tokens SET status = 'cancelled' WHERE employeeId = ? AND status = 'pending'",
      employee.id,
    );

    const resetToken = createSecureToken('rst');
    const expiresAt = addMinutes(new Date(), passwordResetTtlMinutes);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO password_reset_tokens (employeeId, tokenHash, status, expiresAt, requestedIp, userAgent, createdAt)
      VALUES (?, ?, 'pending', ?, ?, ?, NOW())
      `,
      employee.id,
      hashToken(resetToken),
      expiresAt,
      getClientIp(req),
      getUserAgent(req),
    );

    return res.status(200).json({
      message: genericMessage,
      resetToken: process.env.NODE_ENV === 'production' ? undefined : resetToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible solicitar recuperacion.', detail: error.message });
  }
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  const resetToken = String(req.body.resetToken || '').trim();
  const accessCode = String(req.body.accessCode || '').trim();

  if (!resetToken || !/^\d{4,8}$/.test(accessCode)) {
    return res.status(400).json({ message: 'resetToken y accessCode nuevo (4 a 8 digitos) son requeridos.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT id, employeeId, status, expiresAt
      FROM password_reset_tokens
      WHERE tokenHash = ?
      LIMIT 1
      `,
      hashToken(resetToken),
    );
    const reset = rows[0];

    if (!reset || reset.status !== 'pending' || new Date(reset.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ message: 'Token de recuperacion invalido o vencido.' });
    }

    const duplicated = await prisma.$queryRawUnsafe(
      'SELECT id FROM employees WHERE accessCode = ? AND id <> ? LIMIT 1',
      accessCode,
      reset.employeeId,
    );
    if (duplicated.length) {
      return res.status(409).json({ message: 'Ese codigo de acceso ya esta en uso.' });
    }

    await prisma.$executeRawUnsafe('UPDATE employees SET accessCode = ?, updatedAt = NOW() WHERE id = ?', accessCode, reset.employeeId);
    await prisma.$executeRawUnsafe("UPDATE password_reset_tokens SET status = 'used', usedAt = NOW() WHERE id = ?", reset.id);
    await prisma.$executeRawUnsafe(
      "UPDATE auth_sessions SET status = 'revoked', revokedAt = NOW(), revokedReason = 'password_reset', updatedAt = NOW() WHERE employeeId = ? AND status = 'active'",
      reset.employeeId,
    );

    return res.status(200).json({ success: true, message: 'Codigo de acceso actualizado. Inicia sesion nuevamente.' });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible completar recuperacion.', detail: error.message });
  }
});

app.get('/api/security/permissions', requireSecurityRead, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, code, name, module, action, description, isActive, createdAt, updatedAt FROM permisos ORDER BY module ASC, action ASC, code ASC',
    );

    return res.status(200).json({
      permissions: rows.map((item) => ({
        id: Number(item.id),
        code: item.code,
        name: item.name,
        module: item.module,
        action: item.action,
        description: item.description,
        isActive: Boolean(item.isActive),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar permisos.', detail: error.message });
  }
});

app.get('/api/security/roles', requireSecurityRead, async (req, res) => {
  try {
    const roleRows = await prisma.$queryRawUnsafe(
      'SELECT id, code, name, description, isSystem, isActive, createdAt, updatedAt FROM roles ORDER BY isSystem DESC, name ASC',
    );
    const permissionRows = await prisma.$queryRawUnsafe(
      `
      SELECT r.id AS roleId, p.code, p.name, p.module, p.action
      FROM role_permissions rp
      INNER JOIN roles r ON r.id = rp.roleId
      INNER JOIN permisos p ON p.id = rp.permissionId
      ORDER BY r.id ASC, p.module ASC, p.action ASC
      `,
    );
    const permissionsByRole = new Map();
    for (const permission of permissionRows) {
      const key = Number(permission.roleId);
      if (!permissionsByRole.has(key)) {
        permissionsByRole.set(key, []);
      }
      permissionsByRole.get(key).push({
        code: permission.code,
        name: permission.name,
        module: permission.module,
        action: permission.action,
      });
    }

    return res.status(200).json({
      roles: roleRows.map((item) => ({
        id: Number(item.id),
        code: item.code,
        name: item.name,
        description: item.description,
        isSystem: Boolean(item.isSystem),
        isActive: Boolean(item.isActive),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        permissions: permissionsByRole.get(Number(item.id)) || [],
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar roles.', detail: error.message });
  }
});

app.get('/api/security/employees/:id/permissions', requireSecurityRead, async (req, res) => {
  const employeeId = Number(req.params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(400).json({ message: 'ID de empleado invalido.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, username, role, name, isActive FROM employees WHERE id = ? LIMIT 1',
      employeeId,
    );
    const employee = rows[0];
    if (!employee) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }

    const permissions = await getEmployeePermissionCodes(employeeId, employee.role);
    return res.status(200).json({
      employee: {
        id: Number(employee.id),
        username: employee.username,
        role: employee.role,
        name: employee.name,
        isActive: Boolean(employee.isActive),
      },
      permissions,
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar permisos del empleado.', detail: error.message });
  }
});

app.post('/api/security/employees/:id/roles', requireAdmin, async (req, res) => {
  const employeeId = Number(req.params.id);
  const roleCode = String(req.body.roleCode || '').trim().toLowerCase();
  const scopeType = String(req.body.scopeType || 'global').trim().toLowerCase();

  if (!Number.isInteger(employeeId) || employeeId <= 0 || !roleCode) {
    return res.status(400).json({ message: 'employeeId y roleCode son requeridos.' });
  }

  try {
    const roleRows = await prisma.$queryRawUnsafe('SELECT id FROM roles WHERE code = ? AND isActive = 1 LIMIT 1', roleCode);
    const roleId = Number(roleRows[0]?.id || 0);
    if (!roleId) {
      return res.status(404).json({ message: 'Rol no encontrado.' });
    }

    const empresaId = req.body.empresaId ? Number(req.body.empresaId) : null;
    const sucursalId = req.body.sucursalId ? Number(req.body.sucursalId) : null;
    const existing = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM employee_roles
      WHERE employeeId = ?
        AND roleId = ?
        AND scopeType = ?
        AND ((empresaId IS NULL AND ? IS NULL) OR empresaId = ?)
        AND ((sucursalId IS NULL AND ? IS NULL) OR sucursalId = ?)
      LIMIT 1
      `,
      employeeId,
      roleId,
      scopeType || 'global',
      empresaId,
      empresaId,
      sucursalId,
      sucursalId,
    );

    if (existing.length) {
      await prisma.$executeRawUnsafe(
        'UPDATE employee_roles SET isActive = 1, grantedByEmployeeId = ? WHERE id = ?',
        req.authUser.id,
        existing[0].id,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO employee_roles (employeeId, roleId, scopeType, empresaId, sucursalId, grantedByEmployeeId, isActive, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
        `,
        employeeId,
        roleId,
        scopeType || 'global',
        empresaId,
        sucursalId,
        req.authUser.id,
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible asignar rol.', detail: error.message });
  }
});

app.post('/api/security/employees/:id/permissions', requireAdmin, async (req, res) => {
  const employeeId = Number(req.params.id);
  const permissionCode = String(req.body.permissionCode || '').trim();
  const scopeType = String(req.body.scopeType || 'global').trim().toLowerCase();

  if (!Number.isInteger(employeeId) || employeeId <= 0 || !permissionCode) {
    return res.status(400).json({ message: 'employeeId y permissionCode son requeridos.' });
  }

  try {
    const permissionRows = await prisma.$queryRawUnsafe('SELECT id FROM permisos WHERE code = ? AND isActive = 1 LIMIT 1', permissionCode);
    const permissionId = Number(permissionRows[0]?.id || 0);
    if (!permissionId) {
      return res.status(404).json({ message: 'Permiso no encontrado.' });
    }

    const empresaId = req.body.empresaId ? Number(req.body.empresaId) : null;
    const sucursalId = req.body.sucursalId ? Number(req.body.sucursalId) : null;
    const existing = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM employee_permissions
      WHERE employeeId = ?
        AND permissionId = ?
        AND scopeType = ?
        AND ((empresaId IS NULL AND ? IS NULL) OR empresaId = ?)
        AND ((sucursalId IS NULL AND ? IS NULL) OR sucursalId = ?)
      LIMIT 1
      `,
      employeeId,
      permissionId,
      scopeType || 'global',
      empresaId,
      empresaId,
      sucursalId,
      sucursalId,
    );

    if (existing.length) {
      await prisma.$executeRawUnsafe(
        'UPDATE employee_permissions SET grantedByEmployeeId = ? WHERE id = ?',
        req.authUser.id,
        existing[0].id,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO employee_permissions (employeeId, permissionId, scopeType, empresaId, sucursalId, grantedByEmployeeId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        employeeId,
        permissionId,
        scopeType || 'global',
        empresaId,
        sucursalId,
        req.authUser.id,
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible asignar permiso.', detail: error.message });
  }
});

app.get('/api/business/context', requireRoles(['admin', 'cashier', 'waiter', 'kitchen']), async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        e.id AS empresaId,
        e.legalName,
        e.tradeName,
        s.id AS sucursalId,
        s.code AS sucursalCode,
        s.name AS sucursalName
      FROM empresas e
      INNER JOIN sucursales s ON s.empresaId = e.id
      WHERE e.id = ? AND s.id = ?
      LIMIT 1
      `,
      context.empresaId,
      context.sucursalId,
    );
    const row = rows[0];

    return res.status(200).json({
      context: row
        ? {
            empresaId: Number(row.empresaId),
            empresaName: row.tradeName || row.legalName,
            legalName: row.legalName,
            sucursalId: Number(row.sucursalId),
            sucursalCode: row.sucursalCode,
            sucursalName: row.sucursalName,
          }
        : context,
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar contexto de negocio.', detail: error.message });
  }
});

app.get('/api/admin/empresas', requireBusinessManage, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, legalName, tradeName, taxId, phone, email, isActive, createdAt, updatedAt FROM empresas ORDER BY isActive DESC, tradeName ASC',
    );
    return res.status(200).json({
      empresas: rows.map((item) => ({
        id: Number(item.id),
        legalName: item.legalName,
        tradeName: item.tradeName,
        taxId: item.taxId || null,
        phone: item.phone || null,
        email: item.email || null,
        isActive: Boolean(item.isActive),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar empresas.', detail: error.message });
  }
});

app.post('/api/admin/empresas', requireBusinessManage, async (req, res) => {
  const legalName = String(req.body.legalName || '').trim();
  const tradeName = String(req.body.tradeName || legalName).trim();
  const taxId = String(req.body.taxId || '').trim() || null;
  const phone = String(req.body.phone || '').trim() || null;
  const email = String(req.body.email || '').trim() || null;

  if (!legalName || !tradeName) {
    return res.status(400).json({ message: 'legalName y tradeName son requeridos.' });
  }

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO empresas (legalName, tradeName, taxId, phone, email, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
      `,
      legalName,
      tradeName,
      taxId,
      phone,
      email,
    );
    const rows = await prisma.$queryRawUnsafe('SELECT id, legalName, tradeName, taxId, phone, email, isActive, createdAt, updatedAt FROM empresas WHERE id = LAST_INSERT_ID()');
    return res.status(201).json({ empresa: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible crear empresa.', detail: error.message });
  }
});

app.get('/api/admin/sucursales', requireBusinessManage, async (req, res) => {
  const empresaId = parseTenantHeader(req.query.empresaId) || null;

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT s.id, s.empresaId, e.tradeName AS empresaName, s.code, s.name, s.address, s.phone, s.isActive, s.createdAt, s.updatedAt
      FROM sucursales s
      INNER JOIN empresas e ON e.id = s.empresaId
      WHERE (? IS NULL OR s.empresaId = ?)
      ORDER BY e.tradeName ASC, s.name ASC
      `,
      empresaId,
      empresaId,
    );
    return res.status(200).json({
      sucursales: rows.map((item) => ({
        id: Number(item.id),
        empresaId: Number(item.empresaId),
        empresaName: item.empresaName,
        code: item.code,
        name: item.name,
        address: item.address || null,
        phone: item.phone || null,
        isActive: Boolean(item.isActive),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar sucursales.', detail: error.message });
  }
});

app.post('/api/admin/sucursales', requireBusinessManage, async (req, res) => {
  const empresaId = Number(req.body.empresaId);
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim() || null;
  const phone = String(req.body.phone || '').trim() || null;

  if (!Number.isInteger(empresaId) || empresaId <= 0 || !code || !name) {
    return res.status(400).json({ message: 'empresaId, code y name son requeridos.' });
  }

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO sucursales (empresaId, code, name, address, phone, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
      `,
      empresaId,
      code,
      name,
      address,
      phone,
    );
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, empresaId, code, name, address, phone, isActive, createdAt, updatedAt FROM sucursales WHERE id = LAST_INSERT_ID()',
    );
    return res.status(201).json({ sucursal: rows[0] });
  } catch (error) {
    if (error.message?.includes('Duplicate')) {
      return res.status(409).json({ message: 'Ya existe una sucursal con ese codigo para la empresa.' });
    }
    return res.status(500).json({ message: 'No fue posible crear sucursal.', detail: error.message });
  }
});

app.get('/api/catalog/products', async (req, res) => {
  const { includeInactive } = req.query;

  try {
    const context = await getRequestBusinessContext(req);
    const products = await prisma.product.findMany({
      where: scopedProductWhere(context, includeInactive === 'true'),
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({ products: products.map(toProductResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar productos.', detail: error.message });
  }
});

app.get('/api/admin/products', requireProductManage, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const products = await prisma.product.findMany({
      where: scopedProductWhere(context, true),
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({ products: products.map(toProductResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar productos.', detail: error.message });
  }
});

app.post('/api/admin/products', requireProductManage, async (req, res) => {
  const { name, category, price } = req.body;
  const normalizedName = String(name || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedPrice = parsePrice(price);

  if (!normalizedName || !normalizedCategory || normalizedPrice === null) {
    return res.status(400).json({ message: 'name, category y price son requeridos. price debe ser mayor que 0.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const product = await prisma.product.create({
      data: {
        empresaId: context.empresaId,
        sucursalId: context.sucursalId,
        name: normalizedName,
        category: normalizedCategory,
        price: normalizedPrice,
        isActive: true,
      },
    });

    return res.status(201).json({ product: toProductResponse(product) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un producto con ese nombre.' });
    }

    return res.status(500).json({ message: 'No fue posible crear el producto.', detail: error.message });
  }
});

app.patch('/api/admin/products/:id', requireProductManage, async (req, res) => {
  const productId = Number(req.params.id);
  const { name, category, price, isActive } = req.body;

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'ID de producto invalido.' });
  }

  const data = {};

  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName) {
      return res.status(400).json({ message: 'name no puede estar vacio.' });
    }

    data.name = normalizedName;
  }

  if (category !== undefined) {
    const normalizedCategory = String(category).trim();
    if (!normalizedCategory) {
      return res.status(400).json({ message: 'category no puede estar vacio.' });
    }

    data.category = normalizedCategory;
  }

  if (price !== undefined) {
    const normalizedPrice = parsePrice(price);
    if (normalizedPrice === null) {
      return res.status(400).json({ message: 'price debe ser mayor que 0.' });
    }

    data.price = normalizedPrice;
  }

  if (isActive !== undefined) {
    data.isActive = Boolean(isActive);
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'No se recibieron campos para actualizar.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    if (existing.empresaId !== null && Number(existing.empresaId) !== Number(context.empresaId)) {
      return res.status(403).json({ message: 'Producto fuera de la empresa activa.' });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
    });

    return res.status(200).json({ product: toProductResponse(product) });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un producto con ese nombre.' });
    }

    return res.status(500).json({ message: 'No fue posible actualizar el producto.', detail: error.message });
  }
});

app.delete('/api/admin/products/:id', requireProductManage, async (req, res) => {
  const productId = Number(req.params.id);

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'ID de producto invalido.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    if (existing.empresaId !== null && Number(existing.empresaId) !== Number(context.empresaId)) {
      return res.status(403).json({ message: 'Producto fuera de la empresa activa.' });
    }

    const product = await prisma.product.delete({
      where: { id: productId },
    });

    return res.status(200).json({ product: toProductResponse(product) });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    return res.status(500).json({ message: 'No fue posible desactivar el producto.', detail: error.message });
  }
});

app.get('/api/orders', requireOrderRead, async (req, res) => {
  const context = await getRequestBusinessContext(req);
  const sorted = orders
    .filter((order) => {
      const empresaId = Number(order.empresaId || context.empresaId);
      const sucursalId = Number(order.sucursalId || context.sucursalId);
      return empresaId === Number(context.empresaId) && sucursalId === Number(context.sucursalId);
    })
    .sort((a, b) => Number(b.id) - Number(a.id));
  res.status(200).json({ orders: sorted });
});

app.get('/api/table-accounts/open', requireTableRead, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const accounts = await getOpenTableAccounts(context);
    return res.status(200).json({ accounts });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar cuentas de mesa.', detail: error.message });
  }
});

app.get('/api/table-accounts/:tableNumber', requireTableRead, async (req, res) => {
  const tableNumber = Number(req.params.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    return res.status(400).json({ message: 'Numero de mesa invalido.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const account = await getTableAccountByNumber(tableNumber, context);
    return res.status(200).json({ account });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar cuenta de mesa.', detail: error.message });
  }
});

app.put('/api/table-accounts/:tableNumber', requireTableManage, async (req, res) => {
  const tableNumber = Number(req.params.tableNumber);
  const guestCountRaw = req.body.guestCount;
  const lastOrderIdRaw = req.body.lastOrderId;
  const itemsRaw = Array.isArray(req.body.items) ? req.body.items : [];

  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    return res.status(400).json({ message: 'Numero de mesa invalido.' });
  }

  const guestCount = guestCountRaw === null || guestCountRaw === undefined ? null : Number(guestCountRaw);
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 30)) {
    return res.status(400).json({ message: 'guestCount debe ser entero entre 1 y 30.' });
  }

  const lastOrderId = lastOrderIdRaw === null || lastOrderIdRaw === undefined ? null : Number(lastOrderIdRaw);
  if (lastOrderId !== null && (!Number.isInteger(lastOrderId) || lastOrderId <= 0)) {
    return res.status(400).json({ message: 'lastOrderId invalido.' });
  }

  const normalizedItems = itemsRaw
    .map((item) => ({
      productId: Number(item.productId),
      productName: String(item.productName || item.name || '').trim(),
      unitPrice: Number(item.unitPrice ?? item.price),
      quantity: Number(item.quantity),
      notes: String(item.notes || ''),
    }))
    .filter(
      (item) =>
        Number.isInteger(item.productId) &&
        item.productId > 0 &&
        item.productName &&
        Number.isFinite(item.unitPrice) &&
        item.unitPrice >= 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    );

  try {
    const context = await getRequestBusinessContext(req);
    if (req.authUser.role === 'waiter') {
      const tableAccess = ensureWaiterCanUseTable(req.authUser, tableNumber);
      if (!tableAccess.ok) {
        return res.status(403).json({ message: 'No puedes modificar una cuenta de mesa de otro usuario.' });
      }
    }

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO table_accounts (empresaId, sucursalId, tableNumber, guestCount, status, updatedBy, updatedByUserId, lastOrderId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        empresaId = VALUES(empresaId),
        sucursalId = VALUES(sucursalId),
        guestCount = VALUES(guestCount),
        status = 'open',
        updatedBy = VALUES(updatedBy),
        updatedByUserId = VALUES(updatedByUserId),
        lastOrderId = VALUES(lastOrderId),
        updatedAt = NOW()
      `,
      context.empresaId,
      context.sucursalId,
      tableNumber,
      guestCount,
      req.authUser.username,
      req.authUser.id,
      lastOrderId,
    );

    const accountRows = await prisma.$queryRawUnsafe(
      'SELECT id FROM table_accounts WHERE tableNumber = ? LIMIT 1',
      tableNumber,
    );
    const accountId = Number(accountRows[0]?.id || 0);

    if (!accountId) {
      return res.status(500).json({ message: 'No fue posible resolver cuenta de mesa.' });
    }

    await prisma.$executeRawUnsafe('DELETE FROM table_account_items WHERE accountId = ?', accountId);

    for (const item of normalizedItems) {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO table_account_items (accountId, productId, productName, unitPrice, quantity, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        accountId,
        item.productId,
        item.productName,
        Number(item.unitPrice.toFixed(2)),
        item.quantity,
        item.notes || null,
      );
    }

    const account = await getTableAccountByNumber(tableNumber, context);
    return res.status(200).json({ account });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible guardar cuenta de mesa.', detail: error.message });
  }
});

app.delete('/api/table-accounts/:tableNumber', requireTableClose, async (req, res) => {
  const tableNumber = Number(req.params.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    return res.status(400).json({ message: 'Numero de mesa invalido.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe('SELECT id FROM table_accounts WHERE tableNumber = ? AND (sucursalId IS NULL OR sucursalId = ?) LIMIT 1', tableNumber, context.sucursalId);
    const accountId = Number(rows[0]?.id || 0);

    if (!accountId) {
      return res.status(200).json({ success: true });
    }

    await prisma.$executeRawUnsafe('DELETE FROM table_account_items WHERE accountId = ?', accountId);
    await prisma.$executeRawUnsafe(
      "UPDATE table_accounts SET status = 'closed', guestCount = NULL, updatedBy = ?, updatedByUserId = ?, lastOrderId = NULL, updatedAt = NOW() WHERE id = ?",
      req.authUser.username,
      req.authUser.id,
      accountId,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible cerrar cuenta de mesa.', detail: error.message });
  }
});

app.post('/api/table-accounts/:tableNumber/pay', requireOrderPay, async (req, res) => {
  const tableNumber = Number(req.params.tableNumber);
  const method = String(req.body.method || 'efectivo').trim().toLowerCase();

  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    return res.status(400).json({ message: 'Numero de mesa invalido.' });
  }

  if (!['efectivo', 'tarjeta'].includes(method)) {
    return res.status(400).json({ message: 'Metodo invalido. Usa efectivo o tarjeta.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const account = await getTableAccountByNumber(tableNumber, context);
    if (!account || !account.items?.length) {
      return res.status(404).json({ message: 'No hay cuenta abierta con productos para esta mesa.' });
    }

    const total = Number(account.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0).toFixed(2));
    const amountReceived = req.body.amountReceived === undefined ? total : Number(req.body.amountReceived);
    if (!Number.isFinite(amountReceived) || amountReceived < total) {
      return res.status(400).json({ message: 'amountReceived debe ser mayor o igual al total.' });
    }

    const order = buildOrderFromTableAccount(account, req.authUser, {
      method,
      amountReceived,
    });
    recordTelemetry(order.id, 'TABLE_ACCOUNT_PAID', { tableNumber, total, items: order.items.length });

    const result = await finalizePaidOrder(order, req.authUser);
    return res.status(200).json({ order, ...result });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible cobrar cuenta de mesa.', detail: error.message });
  }
});

app.post('/api/orders', requireOrderCreate, async (req, res) => {
  const { items, createdBy, tableNumber, guestCount } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'La orden requiere al menos un item.' });
  }

  const requestedProductIds = [...new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isInteger(id)))];

  if (requestedProductIds.length === 0) {
    return res.status(400).json({ message: 'La orden no contiene productId validos.' });
  }

  let productsInDb;
  let orderContext;
  try {
    orderContext = await getRequestBusinessContext(req);
    productsInDb = await prisma.product.findMany({
      where: {
        ...scopedProductWhere(orderContext, false),
        id: { in: requestedProductIds },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar productos para la orden.', detail: error.message });
  }

  const productMap = new Map(productsInDb.map((product) => [product.id, toProductResponse(product)]));

  const normalizedItems = items
    .map((item) => {
      const product = productMap.get(Number(item.productId));
      const quantity = Number(item.quantity);

      if (!product || Number.isNaN(quantity) || quantity <= 0) {
        return null;
      }

      return {
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity,
        notes: item.notes || '',
        subtotal: product.price * quantity,
      };
    })
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    return res.status(400).json({ message: 'No se encontraron items validos para la orden.' });
  }

  const parsedTableNumber = tableNumber === undefined ? null : Number(tableNumber);
  const parsedGuestCount = guestCount === undefined ? null : Number(guestCount);

  if (parsedTableNumber !== null && (!Number.isInteger(parsedTableNumber) || parsedTableNumber <= 0)) {
    return res.status(400).json({ message: 'tableNumber debe ser un entero mayor que 0.' });
  }

  if (parsedGuestCount !== null && (!Number.isInteger(parsedGuestCount) || parsedGuestCount <= 0)) {
    return res.status(400).json({ message: 'guestCount debe ser un entero mayor que 0.' });
  }

  if (req.authUser?.role === 'waiter') {
    if (parsedTableNumber === null) {
      return res.status(400).json({ message: 'El mesero debe indicar un numero de mesa.' });
    }

    const tableAccess = ensureWaiterCanUseTable(req.authUser, parsedTableNumber);
    if (!tableAccess.ok) {
      return res.status(403).json({
        message: `La mesa ${parsedTableNumber} ya esta ocupada por ${tableAccess.owner}.`,
        conflictOrderId: tableAccess.orderId,
      });
    }
  }

  const total = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const createdAt = new Date().toISOString();
  const order = {
    id: orderSequence,
    empresaId: orderContext.empresaId,
    sucursalId: orderContext.sucursalId,
    status: 'creada',
    createdBy: req.authUser?.username || createdBy || 'sistema-local',
    createdByUserId: Number(req.authUser?.id) || null,
    createdByRole: req.authUser?.role || null,
    createdAt,
    updatedAt: createdAt,
    items: normalizedItems,
    total,
    table:
      parsedTableNumber !== null
        ? {
            number: parsedTableNumber,
            guestCount: parsedGuestCount || null,
          }
        : null,
    metrics: {
      createdAt,
      sentToKitchenAt: null,
      readyAt: null,
      deliveredAt: null,
    },
    payment: {
      paid: false,
      paidAt: null,
      method: null,
      amountReceived: null,
      change: null,
    },
  };

  orders.push(order);
  orderSequence += 1;
  recordTelemetry(order.id, 'ORDER_CREATED', { total, items: normalizedItems.length });

  return res.status(201).json({ order });
});

app.post('/api/orders/:id/send-kitchen', requireKitchenPrint, async (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: 'Orden no encontrada.' });
  }

  if (req.authUser?.role === 'waiter' && !isSameOrderOwner(order, req.authUser)) {
    return res.status(403).json({ message: 'No puedes operar ordenes de otro usuario.' });
  }

  if (!order.metrics.sentToKitchenAt) {
    order.metrics.sentToKitchenAt = new Date().toISOString();
  }

  order.status = 'en_preparacion';
  order.updatedAt = new Date().toISOString();
  recordTelemetry(order.id, 'ORDER_SENT_TO_KITCHEN');

  const kitchenPrint = await printToGroup('kitchen', buildKitchenTicket(order));

  return res.status(200).json({ order, kitchenPrint });
});

app.post('/api/orders/:id/print-ticket', requireCustomerPrint, async (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: 'Orden no encontrada.' });
  }

  if (req.authUser?.role === 'waiter' && !isSameOrderOwner(order, req.authUser)) {
    return res.status(403).json({ message: 'No puedes imprimir ticket de una orden de otro usuario.' });
  }

  const customerTicketPrint = await printToGroup('cashier', buildCustomerPrecheckTicket(order));
  return res.status(200).json({ order, customerTicketPrint });
});

app.patch('/api/orders/:id/status', requireOrderStatusUpdate, (req, res) => {
  const order = findOrder(req.params.id);
  const { status } = req.body;
  const allowedStatus = ['en_preparacion', 'lista', 'entregada'];

  if (!order) {
    return res.status(404).json({ message: 'Orden no encontrada.' });
  }

  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ message: `Status invalido. Usa: ${allowedStatus.join(', ')}` });
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();

  if (status === 'lista' && !order.metrics.readyAt) {
    order.metrics.readyAt = new Date().toISOString();
  }

  if (status === 'entregada' && !order.metrics.deliveredAt) {
    order.metrics.deliveredAt = new Date().toISOString();
  }

  recordTelemetry(order.id, 'ORDER_STATUS_CHANGED', { status });
  return res.status(200).json({ order });
});

app.post('/api/orders/:id/pay', requireOrderPay, async (req, res) => {
  const order = findOrder(req.params.id);
  const method = String(req.body.method || 'efectivo').trim().toLowerCase();
  const amountReceivedRaw = req.body.amountReceived;

  if (!order) {
    return res.status(404).json({ message: 'Orden no encontrada.' });
  }

  if (order.payment.paid) {
    return res.status(409).json({ message: 'La orden ya fue pagada.' });
  }

  const amountReceived = amountReceivedRaw === undefined ? Number(order.total) : Number(amountReceivedRaw);
  if (!Number.isFinite(amountReceived) || amountReceived < Number(order.total)) {
    return res.status(400).json({ message: 'amountReceived debe ser mayor o igual al total.' });
  }

  order.payment = {
    paid: true,
    paidAt: new Date().toISOString(),
    method,
    amountReceived: Number(amountReceived.toFixed(2)),
    change: Number((amountReceived - Number(order.total)).toFixed(2)),
  };
  order.updatedAt = new Date().toISOString();
  order.status = 'pagada';

  recordTelemetry(order.id, 'ORDER_PAID', {
    method,
    amountReceived: order.payment.amountReceived,
    change: order.payment.change,
  });

  try {
    const result = await finalizePaidOrder(order, req.authUser);
    return res.status(200).json({ order, ...result });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible finalizar el pago.', detail: error.message });
  }
});

app.get('/api/inventory/stocks', requireInventoryRead, async (req, res) => {
  const locationKey = req.query.locationKey ? normalizeLocationKey(req.query.locationKey) : null;
  const onlyAlerts = String(req.query.onlyAlerts || '').toLowerCase() === 'true';

  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM inventory_stock
      WHERE isActive = 1
        AND (sucursalId IS NULL OR sucursalId = ?)
        AND (? IS NULL OR locationKey = ?)
        AND (? = 0 OR (minStock > 0 AND quantity <= minStock))
      ORDER BY productName ASC, locationKey ASC
      `,
      context.sucursalId,
      locationKey,
      locationKey,
      onlyAlerts ? 1 : 0,
    );

    return res.status(200).json({ stocks: rows.map(toInventoryStockResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar inventario.', detail: error.message });
  }
});

app.get('/api/inventory/movements', requireInventoryRead, async (req, res) => {
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const type = req.query.type ? String(req.query.type).trim().toLowerCase() : null;
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);

  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT im.*
      FROM inventory_movements im
      LEFT JOIN inventory_stock fs ON fs.id = im.fromStockId
      LEFT JOIN inventory_stock ts ON ts.id = im.toStockId
      WHERE (? IS NULL OR im.productId = ?)
        AND (? IS NULL OR type = ?)
        AND (
          fs.sucursalId IS NULL
          OR fs.sucursalId = ?
          OR ts.sucursalId IS NULL
          OR ts.sucursalId = ?
        )
      ORDER BY im.createdAt DESC, im.id DESC
      LIMIT ?
      `,
      productId,
      productId,
      type,
      type,
      context.sucursalId,
      context.sucursalId,
      limit,
    );

    return res.status(200).json({ movements: rows.map(toInventoryMovementResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar historial de inventario.', detail: error.message });
  }
});

app.get('/api/inventory/alerts', requireInventoryAlertsRead, async (req, res) => {
  const status = String(req.query.status || 'open').trim().toLowerCase();

  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT ia.*
      FROM inventory_alerts ia
      INNER JOIN inventory_stock s ON s.id = ia.stockId
      WHERE (? = 'all' OR ia.status = ?)
        AND (s.sucursalId IS NULL OR s.sucursalId = ?)
      ORDER BY ia.createdAt DESC, ia.id DESC
      `,
      status,
      status,
      context.sucursalId,
    );

    return res.status(200).json({ alerts: rows.map(toInventoryAlertResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar alertas de inventario.', detail: error.message });
  }
});

app.post('/api/inventory/entries', requireInventoryMovementCreate, async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = parsePositiveDecimal(req.body.quantity, 3);
  const unitCost = parsePositiveDecimal(req.body.unitCost, 2);
  const minStock = req.body.minStock === undefined ? null : Number(req.body.minStock);

  if (!Number.isInteger(productId) || productId <= 0 || quantity === null || unitCost === null) {
    return res.status(400).json({ message: 'productId, quantity y unitCost son requeridos y deben ser mayores a cero.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const stock = await applyInventoryEntry({
      productId,
      quantity,
      unitCost,
      locationKey: req.body.locationKey,
      sucursalId: req.body.sucursalId ? Number(req.body.sucursalId) : context.sucursalId,
      minStock: Number.isFinite(minStock) && minStock >= 0 ? minStock : null,
      referenceType: req.body.referenceType ? String(req.body.referenceType).slice(0, 40) : null,
      referenceId: req.body.referenceId ? String(req.body.referenceId).slice(0, 80) : null,
      reason: String(req.body.reason || 'entrada').slice(0, 160),
      notes: req.body.notes ? String(req.body.notes).slice(0, 255) : null,
      authUser: req.authUser,
    });

    if (!stock) {
      return res.status(404).json({ message: 'Producto no encontrado o inactivo.' });
    }

    return res.status(201).json({ stock: toInventoryStockResponse(stock) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible registrar entrada de inventario.', detail: error.message });
  }
});

app.post('/api/inventory/outputs', requireInventoryMovementCreate, async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = parsePositiveDecimal(req.body.quantity, 3);

  if (!Number.isInteger(productId) || productId <= 0 || quantity === null) {
    return res.status(400).json({ message: 'productId y quantity son requeridos y deben ser mayores a cero.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const stock = await applyInventoryOutput({
      productId,
      quantity,
      locationKey: req.body.locationKey,
      sucursalId: context.sucursalId,
      referenceType: req.body.referenceType ? String(req.body.referenceType).slice(0, 40) : null,
      referenceId: req.body.referenceId ? String(req.body.referenceId).slice(0, 80) : null,
      reason: String(req.body.reason || 'salida').slice(0, 160),
      notes: req.body.notes ? String(req.body.notes).slice(0, 255) : null,
      authUser: req.authUser,
      movementType: 'salida',
    });

    if (!stock) {
      return res.status(404).json({ message: 'Producto no encontrado o inactivo.' });
    }

    return res.status(201).json({ stock: toInventoryStockResponse(stock) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible registrar salida de inventario.', detail: error.message });
  }
});

app.post('/api/inventory/waste', requireInventoryAdjust, async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = parsePositiveDecimal(req.body.quantity, 3);

  if (!Number.isInteger(productId) || productId <= 0 || quantity === null) {
    return res.status(400).json({ message: 'productId y quantity son requeridos y deben ser mayores a cero.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const stock = await applyInventoryOutput({
      productId,
      quantity,
      locationKey: req.body.locationKey,
      sucursalId: context.sucursalId,
      reason: String(req.body.reason || 'merma').slice(0, 160),
      notes: req.body.notes ? String(req.body.notes).slice(0, 255) : null,
      authUser: req.authUser,
      movementType: 'merma',
    });

    if (!stock) {
      return res.status(404).json({ message: 'Producto no encontrado o inactivo.' });
    }

    return res.status(201).json({ stock: toInventoryStockResponse(stock) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible registrar merma.', detail: error.message });
  }
});

app.post('/api/inventory/adjustments', requireInventoryAdjust, async (req, res) => {
  const productId = Number(req.body.productId);
  const newQuantity = Number(req.body.newQuantity);

  if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(newQuantity)) {
    return res.status(400).json({ message: 'productId y newQuantity son requeridos.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const stock = await applyInventoryAdjustment({
      productId,
      newQuantity: Number(newQuantity.toFixed(3)),
      locationKey: req.body.locationKey,
      sucursalId: context.sucursalId,
      reason: String(req.body.reason || 'ajuste').slice(0, 160),
      notes: req.body.notes ? String(req.body.notes).slice(0, 255) : null,
      authUser: req.authUser,
    });

    if (!stock) {
      return res.status(404).json({ message: 'Producto no encontrado o inactivo.' });
    }

    return res.status(201).json({ stock: toInventoryStockResponse(stock) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible registrar ajuste de inventario.', detail: error.message });
  }
});

app.post('/api/inventory/transfers', requireInventoryTransfer, async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = parsePositiveDecimal(req.body.quantity, 3);
  const fromLocationKey = normalizeLocationKey(req.body.fromLocationKey || 'global');
  const toLocationKey = normalizeLocationKey(req.body.toLocationKey);

  if (!Number.isInteger(productId) || productId <= 0 || quantity === null || !toLocationKey) {
    return res.status(400).json({ message: 'productId, quantity y toLocationKey son requeridos.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const result = await applyInventoryTransfer({
      productId,
      quantity,
      fromLocationKey,
      toLocationKey,
      sucursalId: context.sucursalId,
      reason: String(req.body.reason || 'transferencia').slice(0, 160),
      notes: req.body.notes ? String(req.body.notes).slice(0, 255) : null,
      authUser: req.authUser,
    });

    if (!result) {
      return res.status(404).json({ message: 'Producto no encontrado o inactivo.' });
    }

    if (result.sameLocation) {
      return res.status(400).json({ message: 'La ubicacion origen y destino no pueden ser iguales.' });
    }

    return res.status(201).json({
      fromStock: toInventoryStockResponse(result.fromStock),
      toStock: toInventoryStockResponse(result.toStock),
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible registrar transferencia.', detail: error.message });
  }
});

app.patch('/api/inventory/stocks/:id/min-stock', requireInventoryAdjust, async (req, res) => {
  const stockId = Number(req.params.id);
  const minStock = Number(req.body.minStock);

  if (!Number.isInteger(stockId) || stockId <= 0 || !Number.isFinite(minStock) || minStock < 0) {
    return res.status(400).json({ message: 'stockId y minStock valido son requeridos.' });
  }

  try {
    await prisma.$executeRawUnsafe('UPDATE inventory_stock SET minStock = ?, updatedAt = NOW() WHERE id = ?', Number(minStock.toFixed(3)), stockId);
    await refreshInventoryAlert(stockId);
    const stock = await getInventoryStock(stockId);

    if (!stock) {
      return res.status(404).json({ message: 'Existencia no encontrada.' });
    }

    return res.status(200).json({ stock: toInventoryStockResponse(stock) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible actualizar stock minimo.', detail: error.message });
  }
});

app.get('/api/admin/employees', requireEmployeeManage, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const employees = await prisma.$queryRawUnsafe(
      `
      SELECT id, empresaId, sucursalId, username, role, name, accessCode, isActive, createdAt, updatedAt
      FROM employees
      WHERE role <> 'admin'
        AND isActive = 1
        AND (empresaId IS NULL OR empresaId = ?)
      ORDER BY role ASC, name ASC
      `,
      context.empresaId,
    );

    return res.status(200).json({ employees: employees.map(normalizeEmployeeResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar empleados.', detail: error.message });
  }
});

app.post('/api/admin/employees', requireEmployeeManage, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const role = String(req.body.role || 'cashier').trim().toLowerCase();
  const accessCode = String(req.body.accessCode || '').trim();

  if (!username || !name || !/^\d{4,8}$/.test(accessCode)) {
    return res.status(400).json({ message: 'name, username y accessCode (4 a 8 digitos) son requeridos.' });
  }

  if (!['cashier', 'kitchen', 'waiter'].includes(role)) {
    return res.status(400).json({ message: 'role invalido. Usa cashier, kitchen o waiter.' });
  }

  try {
    const context = await getRequestBusinessContext(req);
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM employees WHERE username = ? OR accessCode = ? LIMIT 1',
      username,
      accessCode,
    );

    if (existing.length) {
      return res.status(409).json({ message: 'El username o accessCode ya existe.' });
    }

    await prisma.$executeRawUnsafe(
      'INSERT INTO employees (empresaId, sucursalId, username, accessCode, role, name, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())',
      context.empresaId,
      context.sucursalId,
      username,
      accessCode,
      role,
      name,
    );

    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, empresaId, sucursalId, username, role, name, accessCode, isActive, createdAt, updatedAt FROM employees WHERE username = ? LIMIT 1',
      username,
    );

    return res.status(201).json({ employee: normalizeEmployeeResponse(rows[0]) });
  } catch (error) {

    return res.status(500).json({ message: 'No fue posible crear empleado.', detail: error.message });
  }
});

app.delete('/api/admin/employees/:id', requireEmployeeManage, async (req, res) => {
  const employeeId = Number(req.params.id);

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(400).json({ message: 'ID de empleado invalido.' });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, empresaId, sucursalId, username, role, name, accessCode, isActive, createdAt, updatedAt FROM employees WHERE id = ? LIMIT 1',
      employeeId,
    );
    const employee = rows[0];

    if (!employee || !employee.isActive) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }

    if (employee.role === 'admin') {
      return res.status(403).json({ message: 'No se puede eliminar un usuario admin.' });
    }

    await prisma.$executeRawUnsafe(
      'UPDATE employees SET isActive = 0, updatedAt = NOW() WHERE id = ?',
      employeeId,
    );

    return res.status(200).json({ employee: normalizeEmployeeResponse({ ...employee, isActive: false }) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible eliminar empleado.', detail: error.message });
  }
});

app.get('/api/admin/sales/paid-accounts', requireSalesRead, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        orderId,
        paidDay,
        total,
        paymentMethod,
        amountReceived,
        \`change\`,
        createdByUser,
        itemCount,
        paidAt,
        cutReference,
        CONCAT('REF-', LPAD(orderId, 6, '0')) AS reference
      FROM sales
      WHERE (empresaId IS NULL OR empresaId = ?)
        AND (sucursalId IS NULL OR sucursalId = ?)
      ORDER BY paidAt DESC, orderId DESC
      `,
      context.empresaId,
      context.sucursalId,
    );

    const accounts = rows.map((item) => ({
      reference: item.reference,
      orderId: Number(item.orderId),
      paidDay: item.paidDay,
      total: Number(item.total || 0),
      paymentMethod: item.paymentMethod,
      amountReceived: Number(item.amountReceived || 0),
      change: Number(item.change || 0),
      createdByUser: item.createdByUser,
      itemCount: Number(item.itemCount || 0),
      paidAt: item.paidAt,
      cutReference: item.cutReference || null,
    }));

    return res.status(200).json({ accounts });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar cuentas pagadas.', detail: error.message });
  }
});

app.post('/api/admin/sales/cutoff', requireSalesCutoff, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const openAccountsRows = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS total FROM table_accounts WHERE status = 'open' AND (sucursalId IS NULL OR sucursalId = ?)",
      context.sucursalId,
    );
    const openAccounts = Number(openAccountsRows[0]?.total || 0);

    if (openAccounts > 0) {
      return res.status(409).json({ message: 'Hay mesas abiertas. Cierra todas las mesas antes de realizar corte.' });
    }

    const totalsRows = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS paidOrders, COALESCE(SUM(total), 0) AS revenue FROM sales WHERE cutReference IS NULL AND (empresaId IS NULL OR empresaId = ?) AND (sucursalId IS NULL OR sucursalId = ?)',
      context.empresaId,
      context.sucursalId,
    );

    const paidOrders = Number(totalsRows[0]?.paidOrders || 0);
    const revenue = Number(totalsRows[0]?.revenue || 0);

    if (paidOrders <= 0) {
      return res.status(409).json({ message: 'No hay cuentas pagadas para realizar corte.' });
    }

    const now = new Date();
    const cutDate = now.toISOString().slice(0, 10);
    const reference = buildCutReference(now);

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO daily_cuts (empresaId, sucursalId, reference, cutDate, ordersCount, revenue, generatedBy, generatedByUserId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      context.empresaId,
      context.sucursalId,
      reference,
      cutDate,
      paidOrders,
      Number(revenue.toFixed(2)),
      req.authUser.username,
      req.authUser.id,
    );

    await prisma.$executeRawUnsafe(
      'UPDATE sales SET cutReference = ? WHERE cutReference IS NULL AND (empresaId IS NULL OR empresaId = ?) AND (sucursalId IS NULL OR sucursalId = ?)',
      reference,
      context.empresaId,
      context.sucursalId,
    );

    return res.status(200).json({
      cut: {
        reference,
        cutDate,
        ordersCount: paidOrders,
        revenue: Number(revenue.toFixed(2)),
        generatedBy: req.authUser.username,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible realizar corte del dia.', detail: error.message });
  }
});

app.get('/api/admin/sales/daily', requireSalesRead, async (req, res) => {
  try {
    const context = await getRequestBusinessContext(req);
    const grouped = await prisma.$queryRawUnsafe(
      'SELECT paidDay, COUNT(*) AS ordersCount, SUM(total) AS revenue FROM sales WHERE cutReference IS NULL AND (empresaId IS NULL OR empresaId = ?) AND (sucursalId IS NULL OR sucursalId = ?) GROUP BY paidDay ORDER BY paidDay DESC',
      context.empresaId,
      context.sucursalId,
    );

    const totalsRows = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS paidOrders, COALESCE(SUM(total), 0) AS revenue FROM sales WHERE cutReference IS NULL AND (empresaId IS NULL OR empresaId = ?) AND (sucursalId IS NULL OR sucursalId = ?)',
      context.empresaId,
      context.sucursalId,
    );

    const summary = grouped.map((item) => {
      const ordersCount = Number(item.ordersCount || 0);
      const revenue = Number(item.revenue || 0);

      return {
        date: item.paidDay,
        orders: ordersCount,
        revenue: Number(revenue.toFixed(2)),
        averageTicket: ordersCount ? Number((revenue / ordersCount).toFixed(2)) : 0,
      };
    });

    return res.status(200).json({
      summary,
      totals: {
        paidOrders: Number(totalsRows[0]?.paidOrders || 0),
        revenue: Number(Number(totalsRows[0]?.revenue || 0).toFixed(2)),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar resumen diario.', detail: error.message });
  }
});

app.get('/api/telemetry/events', (req, res) => {
  const { orderId } = req.query;

  if (orderId) {
    return res.status(200).json({
      events: telemetryEvents.filter((event) => event.orderId === Number(orderId)),
    });
  }

  return res.status(200).json({ events: telemetryEvents });
});

app.get('/api/telemetry/summary', (req, res) => {
  const deliveredOrders = orders.filter((order) => order.metrics.deliveredAt);
  const processingSeconds = deliveredOrders
    .map((order) => {
      const start = new Date(order.metrics.createdAt).getTime();
      const end = new Date(order.metrics.deliveredAt).getTime();
      return Math.round((end - start) / 1000);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);

  const avgProcessingSeconds = processingSeconds.length
    ? Math.round(processingSeconds.reduce((acc, value) => acc + value, 0) / processingSeconds.length)
    : 0;

  res.status(200).json({
    totals: {
      orders: orders.length,
      delivered: deliveredOrders.length,
      telemetryEvents: telemetryEvents.length,
    },
    avgProcessingSeconds,
  });
});

async function startServer() {
  ensureLogsStorage();
  loadTelemetryFromDisk();

  try {
    await prisma.$connect();
    await ensureTableAccountsSchema();
    await ensureDailyCutsSchema();
    await ensureSalesCutReferenceColumn();
    await ensureMultiCompanySchema();
    await ensureDefaultEmployees();
    await ensureAuthSchema();
    await ensureAuthorizationSchema();
    await ensureInventorySchema();
    await ensureMultiCompanySchema();
    await seedAuthorizationCatalog();
    await initializeOrderSequenceFromSales();
    console.log('[db] Conexion a base de datos lista.');
  } catch (error) {
    console.error('[db] No fue posible conectar con la base de datos. Revisa DATABASE_URL.');
    console.error(error.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
  });
}

startServer();
