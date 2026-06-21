# POS Los Pachecos

Sistema de Punto de Venta (POS) para la taqueria **Los Pachecos**, disenado para automatizar el flujo de toma y procesamiento de ordenes, reducir tiempos de atencion y habilitar instrumentacion cientifica de datos para medir rendimiento operativo.

## Objetivo de Semana 4 (Onboarding y esqueleto inicial)

- Definir estructura base del proyecto.
- Levantar un backend minimo funcional.
- Publicar una pantalla inicial de frontend.
- Establecer base para trazabilidad de eventos y tiempos de procesamiento.

## Avance actual (Semana 5 - base funcional)

- Autenticacion inicial por usuario y PIN en backend.
- Catalogo visual consumido desde API.
- Creacion de ordenes con calculo de total.
- Envio de orden a cocina y actualizacion de estados.
- Registro de eventos de telemetria y resumen de metricas.

## Stack Tecnologico (Base propuesta)

- **Frontend:** HTML5, CSS3 y JavaScript Vanilla
- **Backend:** Node.js con Express
- **Base de Datos:** PostgreSQL

> Nota: esta base puede migrarse despues a React/FastAPI/MySQL sin perder la estructura general.

## Estructura de carpetas

```text
pos-los-pachecos/
|-- backend/
|-- frontend/
|-- database/
`-- docs/
```

## Backlog Inicial (Historias de Usuario Criticas)

### HU-01 Autenticacion de personal
**Como** cajero o administrador,
**quiero** iniciar sesion con credenciales,
**para** acceder de forma segura a las funciones permitidas segun mi rol.

**Criterios de aceptacion**
- Validacion de usuario y contrasena.
- Respuesta de error clara ante credenciales invalidas.
- Registro de intento de inicio de sesion en logs.

### HU-02 Catalogo visual para ordenar
**Como** cajero,
**quiero** ver un catalogo visual de productos (tacos, bebidas, extras),
**para** capturar ordenes rapidamente y con menos errores.

**Criterios de aceptacion**
- Visualizacion por categorias.
- Agregar/quitar productos de una orden.
- Calculo automatico de subtotal y total.

### HU-03 Transmision digital a cocina
**Como** personal de cocina,
**quiero** recibir la orden de forma digital en tiempo real,
**para** comenzar preparacion sin depender de tickets en papel.

**Criterios de aceptacion**
- Al confirmar una orden en caja, se marca como "enviada a cocina".
- Cocina visualiza el detalle (productos, cantidad, notas).
- Cambio de estado de la orden (recibida, en preparacion, lista).

### HU-04 Modulo de telemetria y logs de ordenes
**Como** equipo de operaciones,
**quiero** capturar eventos y tiempos de cada orden,
**para** medir el tiempo total de procesamiento y detectar cuellos de botella.

**Criterios de aceptacion**
- Registrar marcas de tiempo por etapa: creacion, envio a cocina, lista, entrega.
- Guardar logs estructurados por `orderId`, `eventType`, `timestamp`.
- Exponer endpoint base para health check y base para metricas futuras.

## Primeros pasos locales

Prerequisito: tener instalado Node.js LTS (incluye npm).

### Backend

```bash
cd backend
npm install
npm run dev
```

Servidor esperado en: `http://localhost:3000`

### Frontend

Abre `frontend/index.html` en navegador para visualizar la aplicacion base.

## Credenciales demo

- Usuario: `cajero1` | PIN: `1234`
- Usuario: `admin1` | PIN: `4321`

## Endpoints disponibles (base)

- `GET /health`
- `POST /api/auth/login`
- `GET /api/catalog/products`
- `GET /api/orders`
- `POST /api/orders`
- `POST /api/orders/:id/send-kitchen`
- `PATCH /api/orders/:id/status`
- `GET /api/telemetry/events`
- `GET /api/telemetry/summary`

## Convenciones sugeridas para el equipo

- Usar ramas por funcionalidad: `feature/<nombre-corto>`.
- Commits pequenos y descriptivos.
- Documentar decisiones tecnicas en `docs/`.

## Licencia

Proyecto academico para fines educativos.
