# Inventario Profesional

## Objetivo

Extender el POS con un modulo de inventario trazable sin romper ventas, productos, usuarios ni rutas existentes.

## Alcance implementado

- Existencias por producto y ubicacion logica.
- Entradas, salidas, transferencias, ajustes y merma.
- Salida automatica por venta al pagar una orden.
- Costo promedio y costo ultimo por existencia.
- Stock minimo y alertas abiertas/resueltas.
- Historial de movimientos con referencia operativa.

## Tablas

### inventory_stock

Guarda la existencia actual por producto y `locationKey`.

- `productId`: producto relacionado. Es nullable para conservar el registro si el producto se elimina.
- `productName`: snapshot del nombre del producto.
- `locationKey`: ubicacion logica, por defecto `global`.
- `quantity`: existencia actual.
- `averageCost`: costo promedio ponderado.
- `lastCost`: ultimo costo capturado.
- `minStock`: umbral de alerta.

Indice principal: `UNIQUE(productId, locationKey)`.

### inventory_movements

Guarda el historial auditable.

- `type`: `entrada`, `salida`, `transferencia`, `ajuste`, `merma`, `venta`.
- `direction`: `in`, `out` o `transfer`.
- `fromStockId` y `toStockId`: origen/destino cuando aplique.
- `referenceType` y `referenceId`: liga con venta, compra, ajuste externo u otra operacion.
- `previousQuantity` y `newQuantity`: snapshot antes/despues.

Indices: producto-fecha, tipo-fecha, referencia, stock origen/destino y usuario-fecha.

### inventory_alerts

Guarda alertas de stock minimo.

- `status`: `open` o `resolved`.
- `threshold`: stock minimo usado para disparar la alerta.
- `currentQuantity`: existencia al momento de evaluar.

## Integracion con ventas

La ruta existente `POST /api/orders/:id/pay` se mantiene. Al confirmar el pago:

1. Se conserva el guardado actual en `sales`.
2. Se registra una salida de inventario por cada producto vendido.
3. El movimiento queda con `type = venta`, `referenceType = sale` y `referenceId = order.id`.
4. Si inventario falla, el pago no se revierte para no romper la operacion del POS actual.

## Endpoints nuevos

- `GET /api/inventory/stocks`
- `GET /api/inventory/movements`
- `GET /api/inventory/alerts`
- `POST /api/inventory/entries`
- `POST /api/inventory/outputs`
- `POST /api/inventory/waste`
- `POST /api/inventory/adjustments`
- `POST /api/inventory/transfers`
- `PATCH /api/inventory/stocks/:id/min-stock`

## Permisos

- `inventory.read`
- `inventory.movements.create`
- `inventory.adjust`
- `inventory.transfer`
- `inventory.alerts.read`

Administrador hereda todos los permisos. Cajero puede consultar inventario y alertas; movimientos, ajustes y transferencias quedan restringidos a administrador.

## Compatibilidad

- No se eliminan tablas.
- No se renombran tablas existentes.
- No se modifican endpoints existentes.
- No se cambia el contrato de productos ni ventas.
- Las relaciones a productos usan `ON DELETE SET NULL` para no bloquear eliminaciones existentes y conservar historial.

## Migracion Prisma

El esquema Prisma ya contiene los modelos:

- `InventoryStock`
- `InventoryMovement`
- `InventoryAlert`

El backend tambien ejecuta `ensureInventorySchema()` al iniciar para crear tablas faltantes en ambientes donde todavia no se haya corrido una migracion formal.

