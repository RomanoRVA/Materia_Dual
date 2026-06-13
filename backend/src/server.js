const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware base para recibir JSON en futuras rutas del POS.
app.use(express.json());

// Endpoint de salud para validar que el servicio esta disponible.
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'pos-los-pachecos-backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Endpoint inicial de bienvenida para verificar onboarding tecnico.
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'API base de POS Los Pachecos operando correctamente.',
  });
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
});
