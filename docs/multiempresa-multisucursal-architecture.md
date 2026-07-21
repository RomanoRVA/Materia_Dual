# Arquitectura multiempresa / multisucursal

## Objetivo

Evolucionar el POS existente para operar con multiples empresas y sucursales sin romper la operacion actual de Los Pachecos.

Esta fase no elimina tablas, no cambia endpoints existentes y no modifica la forma en que cajeros, meseros o administradores usan el sistema hoy. Agrega contexto empresarial a las tablas operativas y usa una empresa/sucursal por defecto para mantener compatibilidad.

## Empresa y sucursal por defecto

Al iniciar el backend se asegura la existencia de:

- Empresa: `POS Los Pachecos`
- Sucursal: `Matriz`

Los datos existentes de productos, empleados, ventas, cuentas de mesa y cortes se asignan a esa empresa/sucursal cuando no tienen contexto.

## Tablas extendidas

Se agregaron campos opcionales `empresaId` y `sucursalId` a:

- `products`
- `employees`
- `sales`
- `table_accounts`
- `daily_cuts`

Los campos son opcionales para no bloquear datos historicos ni instalaciones que todavia no hayan ejecutado la migracion incremental.

## Aislamiento operativo

El backend ahora filtra por empresa/sucursal en:

- Catalogo de productos
- Administracion de productos
- Usuarios administrativos
- Ordenes abiertas en memoria
- Cuentas de mesa
- Inventario por sucursal
- Cuentas pagadas
- Resumen diario
- Corte de caja

## Contexto de peticion

El contexto se resuelve en este orden:

1. Headers `x-empresa-id` y `x-sucursal-id`.
2. Empresa/sucursal del usuario autenticado.
3. Empresa/sucursal por defecto.

Esto permite mantener compatibilidad con el frontend actual y preparar un selector de empresa/sucursal en una fase posterior.

## Nuevos endpoints

- `GET /api/business/context`
- `GET /api/admin/empresas`
- `POST /api/admin/empresas`
- `GET /api/admin/sucursales`
- `POST /api/admin/sucursales`

Estos endpoints no sustituyen rutas existentes. Solo agregan administracion empresarial.

## Compatibilidad

- Los endpoints existentes conservan sus rutas.
- Los roles actuales siguen funcionando.
- Los usuarios actuales se conservan.
- Las ventas historicas se conservan.
- Los cortes ahora se calculan por sucursal activa.
- El frontend actual sigue usando la sucursal por defecto si no selecciona otra.

## Siguiente fase recomendada

Agregar al panel de administrador:

- Gestion visual de empresas.
- Gestion visual de sucursales.
- Selector de empresa/sucursal activa.
- Configuracion por sucursal: impresoras, numero de mesas, modo restaurante/mostrador y datos del ticket.
