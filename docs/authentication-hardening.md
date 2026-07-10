# Mejora de autenticacion - POS Los Pachecos

## Objetivo

Extender el login numerico actual sin reemplazarlo. La autenticacion nueva conserva
compatibilidad con los headers existentes (`x-user-id`, `x-user-role`) y agrega sesiones
profesionales con refresh token, caducidad, bloqueo por intentos, recuperacion de codigo,
registro de dispositivos, sesiones activas y logout remoto.

## Compatibilidad

- No se cambia la ruta existente `POST /api/auth/login`.
- No se elimina el login numerico actual.
- No se cambian endpoints operativos existentes.
- Los clientes antiguos que no envien `Authorization: Bearer` siguen funcionando con los
  headers actuales.
- Los clientes nuevos reciben `token`, `refreshToken`, expiraciones, `sessionId` y datos
  del dispositivo.

## Tablas

### auth_devices

Registra dispositivos usados para iniciar sesion.

Campos clave:
- `deviceId`: identificador estable del cliente.
- `deviceName`: nombre mostrado.
- `employeeId`: usuario relacionado cuando exista.
- `lastSeenAt`: ultima actividad conocida.

### auth_sessions

Registra sesiones activas, revocadas o expiradas.

Campos clave:
- `accessTokenHash`: hash SHA-256 del access token.
- `refreshTokenHash`: hash SHA-256 del refresh token.
- `expiresAt`: caducidad del access token.
- `refreshExpiresAt`: caducidad del refresh token.
- `status`: `active`, `revoked` o `expired`.
- `revokedReason`: razon de cierre local/remoto/reset.

### login_attempts

Registra intentos exitosos y fallidos para bloqueo temporal.

Regla default:
- 5 intentos fallidos en 15 minutos bloquean temporalmente el login por codigo/IP.

Variables:
- `LOGIN_LOCK_WINDOW_MINUTES`
- `LOGIN_LOCK_MAX_ATTEMPTS`

### password_reset_tokens

Registra tokens de recuperacion de codigo.

Regla default:
- Token vigente 20 minutos.

Variable:
- `PASSWORD_RESET_TTL_MINUTES`

## Endpoints nuevos

### POST /api/auth/refresh

Renueva access token y refresh token.

Body:

```json
{
  "refreshToken": "rtk_..."
}
```

### POST /api/auth/logout

Cierra la sesion actual.

Requiere:
- `Authorization: Bearer <token>` para cierre de sesion real.
- Si se usa cliente antiguo, responde ok en modo legacy.

### GET /api/auth/sessions

Lista sesiones activas/historicas.

Reglas:
- Admin ve todas.
- Usuario normal ve sus propias sesiones.

### DELETE /api/auth/sessions/:id

Logout remoto.

Reglas:
- Admin puede cerrar cualquier sesion.
- Usuario normal solo puede cerrar sus propias sesiones.

### POST /api/auth/password-reset/request

Solicita recuperacion de codigo.

Body:

```json
{
  "username": "cajero1"
}
```

En desarrollo puede devolver `resetToken` porque no existe proveedor de email/SMS. En
produccion no debe exponerse y se debe integrar un canal seguro.

### POST /api/auth/password-reset/confirm

Confirma nuevo codigo numerico.

Body:

```json
{
  "resetToken": "rst_...",
  "accessCode": "123456"
}
```

Al cambiar codigo se revocan sesiones activas del usuario.

## Flujo frontend

1. Login actual envia `accessCode`.
2. Adicionalmente envia `deviceId` y `deviceName`.
3. Backend devuelve `token`, `refreshToken`, expiraciones y `sessionId`.
4. Frontend guarda la sesion en `localStorage`.
5. Requests nuevos mandan:
   - `Authorization: Bearer <token>`
   - `x-session-id`
   - `x-user-id`
   - `x-user-role`
6. Si un request centralizado recibe 401, intenta refresh una vez.
7. Logout local tambien intenta revocar la sesion en backend.

## Variables recomendadas

```env
ACCESS_TOKEN_TTL_MINUTES=480
REFRESH_TOKEN_TTL_DAYS=30
LOGIN_LOCK_WINDOW_MINUTES=15
LOGIN_LOCK_MAX_ATTEMPTS=5
PASSWORD_RESET_TTL_MINUTES=20
```

## Riesgos y pendientes

- Los `accessCode` actuales siguen almacenados en texto plano por compatibilidad. La
  siguiente fase debe agregar hash gradual sin bloquear usuarios existentes.
- La recuperacion de codigo requiere canal seguro real en produccion.
- Algunos llamados frontend directos con `fetch` no reintentan refresh automaticamente;
  el refresh periodico reduce el riesgo sin reescribir el modulo completo.
- El modo legacy se conserva para no romper clientes actuales; debe retirarse cuando todo
  el frontend use Bearer token.
