# Arquitectura de roles y permisos granulares

## Objetivo

Transformar el control de acceso de roles simples a un modelo granular de permisos
por modulo y accion, sin modificar usuarios existentes y sin romper los endpoints
actuales.

## Compatibilidad

- No se modifica la tabla `employees`.
- No se modifica el campo existente `employees.role`.
- No se eliminan roles heredados (`admin`, `cashier`, `waiter`, `kitchen`).
- No se cambian rutas existentes.
- Se agregan tablas nuevas para roles profesionales y permisos heredados.
- Los usuarios existentes heredan permisos desde su valor actual en `employees.role`.

## Modelo conceptual

### Rol heredado

El campo actual `employees.role` se conserva como compatibilidad operativa.

Ejemplos:
- `admin`
- `cashier`
- `waiter`
- `kitchen`

### Rol profesional

La tabla `roles` representa un catalogo formal de roles. Un empleado puede tener uno
o mas roles por medio de `employee_roles`.

### Permiso

La tabla `permisos` define capacidades granulares con esta estructura:

```txt
code = modulo.accion
module = modulo funcional
action = accion granular
```

Ejemplos:
- `admin.products.manage`
- `orders.pay`
- `tables.manage`
- `auth.sessions.revoke`

### Permiso por rol

La tabla `role_permissions` asigna permisos a roles. Esto permite permisos heredados.

### Permiso directo por usuario

La tabla `employee_permissions` permite otorgar permisos especiales a un usuario sin
cambiar su rol base.

### Rol directo por usuario

La tabla `employee_roles` permite asignar roles adicionales a un usuario sin tocar
`employees.role`.

## Herencia de permisos

Un usuario obtiene permisos desde tres fuentes:

1. Permisos directos en `employee_permissions`.
2. Permisos heredados por roles asignados en `employee_roles`.
3. Permisos heredados por compatibilidad desde `employees.role`.

El rol `admin` conserva acceso total por compatibilidad y seguridad operativa.

## Modulos y acciones iniciales

### catalog

- `catalog.products.read`

### admin.products

- `admin.products.manage`

### admin.employees

- `admin.employees.manage`

### admin.sales

- `admin.sales.read`
- `admin.sales.cutoff`

### orders

- `orders.read`
- `orders.create`
- `orders.status.update`
- `orders.pay`

### orders.print

- `orders.print.kitchen`
- `orders.print.customer`

### tables

- `tables.read`
- `tables.manage`

### auth.sessions

- `auth.sessions.read`
- `auth.sessions.revoke`

### security.permissions

- `security.permissions.read`
- `security.permissions.manage`

## Middleware y guards

### requireRoles

Se conserva como capa de compatibilidad. Valida:

- Bearer token si existe.
- Headers legacy `x-user-id` y `x-user-role` si no existe token.
- Rol permitido historico.

### requirePermission

Nuevo guard granular. Primero usa `requireRoles` y despues valida que el usuario tenga
el permiso requerido.

### requireModuleAction

Helper para construir permisos con `module + action`.

## Endpoints nuevos

### GET /api/security/permissions

Lista permisos disponibles.

### GET /api/security/roles

Lista roles y permisos heredados por cada rol.

### GET /api/security/employees/:id/permissions

Lista permisos efectivos de un empleado.

### POST /api/security/employees/:id/roles

Asigna un rol profesional adicional a un empleado.

### POST /api/security/employees/:id/permissions

Asigna un permiso directo a un empleado.

## Endpoints existentes protegidos con permisos

- Productos admin: `admin.products.manage`
- Usuarios admin: `admin.employees.manage`
- Ventas admin: `admin.sales.read`
- Corte: `admin.sales.cutoff`
- Ordenes: `orders.*`
- Mesas: `tables.*`
- Sesiones: `auth.sessions.*`

## Migracion Prisma

Ejecutar:

```powershell
cd backend
npm.cmd run prisma:generate
npx.cmd prisma validate
npx.cmd prisma db push
```

Si aparece advertencia de perdida de datos, detenerse y revisar antes de aceptar.

## Riesgos

- Si las tablas `roles`, `permisos`, `role_permissions` o `employee_roles` no existen,
  el backend las crea al arrancar.
- Si el catalogo no esta sembrado, el backend lo siembra de forma idempotente.
- El modo legacy se conserva para no romper clientes existentes.
- Una fase futura deberia construir UI para administrar roles/permisos desde admin.
