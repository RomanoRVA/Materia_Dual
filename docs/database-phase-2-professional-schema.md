# Fase 2 - Modelo profesional de base de datos

## Objetivo

Extender la base de datos actual del POS sin eliminar tablas, sin modificar datos existentes
y sin cambiar endpoints. Esta fase prepara capacidades empresariales para caja,
compras, proveedores, permisos, bitacora, auditoria, empresas y sucursales.

## Compatibilidad

- No se eliminan tablas existentes.
- No se renombran tablas existentes.
- No se modifican columnas existentes.
- No se cambian endpoints actuales.
- No se modifica frontend.
- Las tablas nuevas se agregan mediante Prisma como extension del modelo.
- Las tablas operativas existentes creadas previamente por el backend tambien quedan
  registradas en Prisma para evitar drift: `table_accounts`, `table_account_items`
  y `daily_cuts`.
- Las relaciones hacia `employees`, `products` y `sales` son compatibles con las tablas
  actuales y no requieren alterar sus columnas; Prisma solo agrega campos relacionales
  virtuales en esos modelos.

## Tablas existentes ahora mapeadas en Prisma

### table_accounts

Cuenta operativa de mesa creada por el backend actual.

Compatibilidad:
- Se conserva el nombre fisico `table_accounts`.
- Se conserva `tableNumber` como campo unico.
- No se agrega FK hacia `employees` ni hacia ordenes porque la tabla actual no las tiene.

### table_account_items

Detalle temporal de cuenta de mesa.

Compatibilidad:
- Se conserva el nombre fisico `table_account_items`.
- Se mantiene FK `accountId -> table_accounts.id` con cascada.
- No se agrega FK a `products` porque la tabla actual guarda `productId` sin constraint.

### daily_cuts

Historial de cortes ya creado por el backend.

Compatibilidad:
- Se conserva el nombre fisico `daily_cuts`.
- Se conserva `reference` como unico.
- No se agrega FK a `employees` porque la tabla actual no la tiene.

## Tablas nuevas

### empresas

Representa la razon social o unidad fiscal propietaria de una o varias sucursales.

Relaciones:
- `empresas 1:N sucursales`
- `empresas 1:N proveedores`
- `empresas 1:N bitacora`
- `empresas 1:N auditoria`
- `empresas 1:N employee_permissions`

Indices:
- `isActive`
- `taxId`

### sucursales

Representa puntos de venta fisicos o unidades operativas.

Relaciones:
- `sucursales N:1 empresas`
- `sucursales 1:N cajas`
- `sucursales 1:N movimientos_caja`
- `sucursales 1:N proveedores`
- `sucursales 1:N compras`
- `sucursales 1:N bitacora`
- `sucursales 1:N auditoria`
- `sucursales 1:N employee_permissions`

Llaves:
- FK `empresaId -> empresas.id`
- Unique `empresaId + code`

Indices:
- `empresaId + isActive`

### cajas

Representa una caja operativa por sucursal. Permite apertura, cierre y saldos.

Relaciones:
- `cajas N:1 sucursales`
- `cajas N:1 employees` como usuario de apertura
- `cajas N:1 employees` como usuario de cierre
- `cajas 1:N movimientos_caja`

Llaves:
- FK `sucursalId -> sucursales.id`
- FK opcional `openedByEmployeeId -> employees.id`
- FK opcional `closedByEmployeeId -> employees.id`
- Unique `sucursalId + code`

Indices:
- `sucursalId + status`
- `openedByEmployeeId`
- `closedByEmployeeId`

### movimientos_caja

Registra entradas, salidas, pagos, retiros, compras pagadas y ajustes.

Relaciones:
- `movimientos_caja N:1 cajas`
- `movimientos_caja N:1 sucursales`
- `movimientos_caja N:1 employees`
- `movimientos_caja N:1 sales`
- `movimientos_caja N:1 compras`

Llaves:
- FK `cajaId -> cajas.id`
- FK `sucursalId -> sucursales.id`
- FK opcional `employeeId -> employees.id`
- FK opcional `saleId -> sales.id`
- FK opcional `compraId -> compras.id`

Indices:
- `cajaId + occurredAt`
- `sucursalId + occurredAt`
- `employeeId + occurredAt`
- `type + occurredAt`
- `saleId`
- `compraId`

### proveedores

Registra proveedores por empresa, con asignacion opcional a sucursal.

Relaciones:
- `proveedores N:1 empresas`
- `proveedores N:1 sucursales`
- `proveedores 1:N compras`

Llaves:
- FK `empresaId -> empresas.id`
- FK opcional `sucursalId -> sucursales.id`
- Unique `empresaId + businessName`

Indices:
- `empresaId + isActive`
- `sucursalId`
- `taxId`

### compras

Encabezado de compra a proveedor.

Relaciones:
- `compras N:1 proveedores`
- `compras N:1 sucursales`
- `compras N:1 employees`
- `compras 1:N detalle_compra`
- `compras 1:N movimientos_caja`

Llaves:
- FK `proveedorId -> proveedores.id`
- FK `sucursalId -> sucursales.id`
- FK opcional `employeeId -> employees.id`

Indices:
- `proveedorId + purchaseDate`
- `sucursalId + purchaseDate`
- `employeeId`
- `status + purchaseDate`
- `reference`

### detalle_compra

Detalle de productos comprados. Puede referenciar productos existentes o conservar
nombre historico del producto si no existe catalogo ligado.

Relaciones:
- `detalle_compra N:1 compras`
- `detalle_compra N:1 products`

Llaves:
- FK `compraId -> compras.id`
- FK opcional `productId -> products.id`

Indices:
- `compraId`
- `productId`

### bitacora

Registro operativo de eventos del sistema. Sirve para diagnostico y seguimiento.

Relaciones:
- `bitacora N:1 empresas`
- `bitacora N:1 sucursales`
- `bitacora N:1 employees`

Llaves:
- FK opcional `empresaId -> empresas.id`
- FK opcional `sucursalId -> sucursales.id`
- FK opcional `employeeId -> employees.id`

Indices:
- `createdAt`
- `empresaId + createdAt`
- `sucursalId + createdAt`
- `employeeId + createdAt`
- `module + action`

### auditoria

Registro de cambios de datos sensibles o administrativos.

Relaciones:
- `auditoria N:1 empresas`
- `auditoria N:1 sucursales`
- `auditoria N:1 employees`

Llaves:
- FK opcional `empresaId -> empresas.id`
- FK opcional `sucursalId -> sucursales.id`
- FK opcional `employeeId -> employees.id`

Indices:
- `entityName + entityId`
- `operation + createdAt`
- `employeeId + createdAt`
- `empresaId + createdAt`
- `sucursalId + createdAt`

### permisos

Catalogo de permisos por modulo y accion.

Relaciones:
- `permisos 1:N employee_permissions`

Llaves:
- Unique `code`

Indices:
- `module + action`
- `isActive`

### employee_permissions

Tabla puente para asignar permisos a usuarios existentes (`employees`) con alcance
global, por empresa o por sucursal.

Relaciones:
- `employee_permissions N:1 employees`
- `employee_permissions N:1 permisos`
- `employee_permissions N:1 empresas`
- `employee_permissions N:1 sucursales`
- `employee_permissions N:1 employees` como usuario que otorgo el permiso

Llaves:
- FK `employeeId -> employees.id`
- FK `permissionId -> permisos.id`
- FK opcional `empresaId -> empresas.id`
- FK opcional `sucursalId -> sucursales.id`
- FK opcional `grantedByEmployeeId -> employees.id`
- Unique `employeeId + permissionId + scopeType + empresaId + sucursalId`

Indices:
- `permissionId`
- `empresaId`
- `sucursalId`
- `grantedByEmployeeId`

## Migracion Prisma

### Importante: no usar migrate reset

Si Prisma muestra `Drift detected` y sugiere `prisma migrate reset`, no lo ejecutes en
esta base. Ese comando elimina datos.

El drift aparece porque el proyecto ya tenia tablas creadas por SQL runtime y no habia
carpeta `prisma/migrations` con historial.

### Camino seguro inmediato para esta base existente

Con el esquema actualizado y las tablas existentes mapeadas, validar primero:

```powershell
cd backend
npm.cmd run prisma:generate
npx.cmd prisma validate
```

Para aplicar solo extension de estructura sin reset:

```powershell
cd backend
npx.cmd prisma db push
```

### Camino profesional con SQL revisable

Para produccion, generar y revisar SQL antes de aplicarlo. En PowerShell, si Prisma no
toma `$env:DATABASE_URL` como argumento, usa el datasource del schema:

```powershell
cd backend
npx.cmd prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

Si se quiere usar la URL explicitamente:

```powershell
cd backend
npx.cmd prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Nota: el comando anterior requiere que `$env:DATABASE_URL` exista en la sesion de
PowerShell. Prisma puede cargar `.env` para sus comandos, pero PowerShell no convierte
automaticamente ese archivo en una variable `$env:`.

## Riesgos controlados

- Crear tablas nuevas no debe afectar datos existentes.
- Las FKs requieren que el motor use InnoDB y que las tablas existentes tengan los tipos
  compatibles actuales.
- La tabla `sales` ya tiene `id` entero autoincremental, por lo que puede ser referenciada
  por `movimientos_caja`.
- Las relaciones con `employees` y `products` son opcionales donde existe riesgo historico.
- No se agregan triggers ni cambios automaticos de comportamiento en esta fase.

## Fuera de alcance de esta fase

- No se crean endpoints nuevos.
- No se modifica frontend.
- No se migran ordenes en memoria a tablas persistentes.
- No se implementa validacion de permisos en middleware.
- No se registran movimientos de caja automaticamente.
