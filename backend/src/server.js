const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const users = [
  { id: 1, username: 'cajero1', pin: '1234', role: 'cashier', name: 'Caja Principal' },
  { id: 2, username: 'admin1', pin: '4321', role: 'admin', name: 'Administrador' },
];

const products = [
  { id: 101, name: 'Taco al Pastor', category: 'Tacos', price: 18 },
  { id: 102, name: 'Taco de Bistec', category: 'Tacos', price: 20 },
  { id: 103, name: 'Quesadilla de Maiz', category: 'Especiales', price: 35 },
  { id: 104, name: 'Agua de Horchata', category: 'Bebidas', price: 22 },
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

app.get('/api/catalog/products', (req, res) => {
  res.status(200).json({ products });
});

app.get('/api/orders', (req, res) => {
  const sorted = [...orders].sort((a, b) => Number(b.id) - Number(a.id));
  res.status(200).json({ orders: sorted });
});

app.post('/api/orders', (req, res) => {
  const { items, createdBy } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'La orden requiere al menos un item.' });
  }

  const normalizedItems = items
    .map((item) => {
      const product = products.find((productItem) => productItem.id === Number(item.productId));
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

app.listen(PORT, () => {
  ensureLogsStorage();
  loadTelemetryFromDisk();
  console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
});
