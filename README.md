# POS Los Pachecos

Sistema de punto de venta para administrar la operación diaria de la taquería **Los Pachecos**. La aplicación concentra en una sola interfaz la toma de pedidos, el control de mesas, el envío de comandas a cocina, los cobros, el inventario y la administración del negocio.

## ¿Qué hace el programa?

El flujo principal comienza cuando un empleado inicia sesión con su código de acceso. Según su rol y permisos, puede:

- Consultar el catálogo de productos por categoría y capturar pedidos.
- Abrir mesas, registrar el número de comensales y agregar productos con cantidades y notas.
- Enviar comandas a cocina y actualizar su estado durante la preparación.
- Imprimir comandas de cocina y tickets para el cliente en impresoras configuradas.
- Cobrar órdenes en efectivo u otros métodos, calcular el cambio y cerrar la cuenta.
- Consultar las ventas del día y generar cortes de caja.
- Registrar entradas, salidas, mermas, ajustes y transferencias de inventario.
- Definir existencias mínimas y consultar alertas de productos con bajo inventario.
- Crear, editar o desactivar productos y empleados.
- Administrar empresas, sucursales, roles y permisos granulares.
- Consultar y revocar sesiones activas de los usuarios.
- Registrar telemetría de las órdenes para analizar tiempos y eventos de operación.

La interfaz se adapta al perfil de **administrador**, **cajero**, **mesero** o **cocina**, mostrando únicamente las funciones que corresponden a cada usuario.

## Flujo de una venta

1. El empleado inicia sesión con su código de acceso.
2. Selecciona o abre una mesa.
3. Agrega productos del catálogo y, si es necesario, notas para cocina.
4. Envía la orden a cocina.
5. Cocina actualiza el estado del pedido hasta marcarlo como listo.
6. Caja registra el método de pago, calcula el cambio e imprime el ticket.
7. La venta queda disponible para los reportes y el corte diario.

## Módulos principales

| Módulo | Función |
| --- | --- |
| Autenticación | Inicio de sesión por código, renovación y cierre de sesión, bloqueo por intentos fallidos y recuperación de acceso. |
| Pedidos y mesas | Apertura de mesas, captura de productos, notas, seguimiento de estados y cierre de cuentas. |
| Caja y ventas | Cobro de órdenes, cálculo de cambio, consulta de ventas y cortes diarios. |
| Productos | Catálogo, precios, categorías y activación o desactivación de productos. |
| Inventario | Existencias, costos, movimientos, mermas, ajustes, transferencias y alertas de stock mínimo. |
| Administración | Empleados, empresas, sucursales, roles y permisos por módulo. |
| Impresión | Comandas para cocina y tickets para clientes mediante impresoras de red configurables. |
| Telemetría | Registro de eventos y resumen de tiempos del procesamiento de órdenes. |

## Tecnologías

- **Frontend:** HTML5, CSS3 y JavaScript sin frameworks.
- **Backend:** Node.js y Express.
- **Base de datos:** MySQL con Prisma ORM; preparado para Amazon RDS.
- **Escritorio:** Electron y un iniciador para Windows.

## Estructura del proyecto

```text
pos-los-pachecos/
├── backend/
│   ├── prisma/           # Esquema y datos iniciales
│   ├── scripts/          # Utilidades de mantenimiento
│   └── src/server.js     # API y lógica del sistema
├── desktop/              # Aplicación de escritorio con Electron
├── docs/                 # Documentación técnica y de arquitectura
├── frontend/             # Login e interfaz del POS
├── launch-pos.bat        # Inicio rápido en Windows
├── start.ps1             # Inicia backend, frontend y ventana de la aplicación
└── stop.ps1              # Detiene los servicios locales
```

## Requisitos

- Windows 10 u 11 para usar los scripts de inicio incluidos.
- Node.js LTS y npm.
- Python 3, utilizado por `start.ps1` para servir el frontend.
- Una instancia de MySQL accesible, local o en Amazon RDS.

## Configuración inicial

1. Instala las dependencias del backend:

   ```powershell
   cd backend
   npm install
   ```

2. Crea el archivo de configuración:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edita `backend/.env` y coloca la conexión real a MySQL:

   ```env
   DATABASE_URL="mysql://USUARIO:CONTRASEÑA@SERVIDOR:3306/pos_los_pachecos?sslaccept=strict"
   ```

4. Prepara la base de datos:

   ```powershell
   npm run prisma:generate
   npm run prisma:push
   npm run prisma:seed
   ```

La guía específica para Amazon RDS está en [`docs/rds-mysql-setup.md`](docs/rds-mysql-setup.md).

## Ejecutar el programa

Desde la carpeta raíz del proyecto, ejecuta:

```powershell
.\start.ps1
```

También puedes abrir `launch-pos.bat`. El iniciador:

- levanta la API en `http://localhost:3000`;
- sirve el frontend en `http://localhost:5500`;
- abre el POS como una ventana de aplicación en Edge o Chrome;
- detiene ambos servicios cuando se cierra la ventana.

Para detener manualmente los servicios:

```powershell
.\stop.ps1
```

### Ejecución manual

Backend:

```powershell
cd backend
npm run dev
```

Frontend, en otra terminal:

```powershell
cd frontend
python -m http.server 5500
```

Después abre `http://localhost:5500`.

## Usuarios iniciales

El backend crea usuarios de arranque si todavía no existen:

| Rol | Usuario | Código de acceso |
| --- | --- | --- |
| Administrador | `admin1` | `200640` |
| Cajero | `cajero1` | `100540` |

> Estos códigos son únicamente para configuración o demostración. Deben cambiarse antes de usar el sistema en producción.

## Configuración opcional

Además de `DATABASE_URL`, el backend admite variables para:

- puerto del servidor;
- duración de sesiones y tokens de renovación;
- límite de intentos fallidos de acceso;
- contexto inicial de empresa y sucursal;
- activación de impresión;
- impresoras de cocina y caja.

Consulta el código de configuración en `backend/src/server.js` y la documentación técnica de `docs/` para conocer la arquitectura de autenticación, inventario, permisos y operación multiempresa.

## Persistencia

MySQL almacena productos, empleados, sesiones, permisos, empresas, sucursales, ventas, cortes e inventario. La telemetría también se escribe como JSON Lines en:

```text
backend/logs/telemetry-events.jsonl
```

Las órdenes operativas activas se mantienen en memoria durante la ejecución del backend; al cobrar, la venta queda registrada en la base de datos.

## Estado del proyecto

El proyecto es una implementación académica y funcional orientada a la operación de una taquería. Antes de desplegarlo en producción se recomienda reforzar la seguridad de credenciales, restringir CORS, configurar respaldos de MySQL, usar HTTPS y validar las impresoras y la red del establecimiento.

## Licencia

Proyecto académico para fines educativos.
