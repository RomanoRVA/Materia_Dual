const fs = require('fs');
const path = require('path');
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

const users = [
  { id: 1, username: 'cajero1', pin: '1234', role: 'cashier', name: 'Caja Principal' },
  { id: 2, username: 'admin1', pin: '4321', role: 'admin', name: 'Administrador' },
];

const orders = [];
const telemetryEvents = [];
let orderSequence = 1;

const logsDir = path.join(__dirname, '..', 'logs');
const telemetryLogFile = path.join(logsDir, 'telemetry-events.jsonl');

// Middleware base para recibir JSON en futuras rutas del POS.
app.use(express.json());

// CORS abierto para onboarding local (frontend servido desde archivo o puerto distinto).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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

function toProductResponse(product) {
  return {
    id: product.id,
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

app.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body;

  if (!username || !pin) {
    return res.status(400).json({ message: 'username y pin son requeridos.' });
  }

  const user = users.find((item) => item.username === username && item.pin === pin);

  if (!user) {
    return res.status(401).json({ message: 'Credenciales invalidas.' });
  }

  return res.status(200).json({
    token: `local-token-${user.id}`,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    },
  });
});

app.get('/api/catalog/products', async (req, res) => {
  const { includeInactive } = req.query;

  try {
    const products = await prisma.product.findMany({
      where: includeInactive === 'true' ? {} : { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({ products: products.map(toProductResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar productos.', detail: error.message });
  }
});

app.get('/api/admin/products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({ products: products.map(toProductResponse) });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible consultar productos.', detail: error.message });
  }
});

app.post('/api/admin/products', async (req, res) => {
  const { name, category, price } = req.body;
  const normalizedName = String(name || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedPrice = parsePrice(price);

  if (!normalizedName || !normalizedCategory || normalizedPrice === null) {
    return res.status(400).json({ message: 'name, category y price son requeridos. price debe ser mayor que 0.' });
  }

  try {
    const product = await prisma.product.create({
      data: {
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

app.patch('/api/admin/products/:id', async (req, res) => {
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

app.delete('/api/admin/products/:id', async (req, res) => {
  const productId = Number(req.params.id);

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'ID de producto invalido.' });
  }

  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    return res.status(200).json({ product: toProductResponse(product) });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    return res.status(500).json({ message: 'No fue posible desactivar el producto.', detail: error.message });
  }
});

app.get('/api/orders', (req, res) => {
  const sorted = [...orders].sort((a, b) => Number(b.id) - Number(a.id));
  res.status(200).json({ orders: sorted });
});

app.post('/api/orders', async (req, res) => {
  const { items, createdBy } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'La orden requiere al menos un item.' });
  }

  const requestedProductIds = [...new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isInteger(id)))];

  if (requestedProductIds.length === 0) {
    return res.status(400).json({ message: 'La orden no contiene productId validos.' });
  }

  let productsInDb;
  try {
    productsInDb = await prisma.product.findMany({
      where: {
        id: { in: requestedProductIds },
        isActive: true,
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

  const total = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const createdAt = new Date().toISOString();
  const order = {
    id: orderSequence,
    status: 'creada',
    createdBy: createdBy || 'sistema-local',
    createdAt,
    updatedAt: createdAt,
    items: normalizedItems,
    total,
    metrics: {
      createdAt,
      sentToKitchenAt: null,
      readyAt: null,
      deliveredAt: null,
    },
  };

  orders.push(order);
  orderSequence += 1;
  recordTelemetry(order.id, 'ORDER_CREATED', { total, items: normalizedItems.length });

  return res.status(201).json({ order });
});

app.post('/api/orders/:id/send-kitchen', (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: 'Orden no encontrada.' });
  }

  if (!order.metrics.sentToKitchenAt) {
    order.metrics.sentToKitchenAt = new Date().toISOString();
  }

  order.status = 'en_preparacion';
  order.updatedAt = new Date().toISOString();
  recordTelemetry(order.id, 'ORDER_SENT_TO_KITCHEN');

  return res.status(200).json({ order });
});

app.patch('/api/orders/:id/status', (req, res) => {
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
    console.log('[db] Conexion a PostgreSQL lista.');
  } catch (error) {
    console.error('[db] No fue posible conectar con PostgreSQL. Revisa DATABASE_URL.');
    console.error(error.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
  });
}

startServer();
