# Configuracion Amazon RDS MySQL para POS Los Pachecos

## 1) Crear instancia RDS (resumen)

- Motor: MySQL 8.0
- Plantilla: Free tier (si aplica)
- DB instance identifier: pos-los-pachecos-db
- Master username: admin
- Master password: segura
- Public access: Yes (solo para desarrollo)
- VPC security group: permitir entrada TCP 3306 desde tu IP publica

## 2) Crear base de datos logica

Conectate a la instancia y ejecuta:

CREATE DATABASE pos_los_pachecos;

## 3) Configurar variable de entorno

En backend/.env define DATABASE_URL con este formato:

mysql://admin:TU_PASSWORD@TU_ENDPOINT_RDS:3306/pos_los_pachecos?sslaccept=strict

## 4) Sincronizar esquema y cargar seed

En backend:

npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:push
npm.cmd run prisma:seed

## 5) Arrancar API

npm.cmd run dev

## 6) Validacion

- GET /health debe responder status ok.
- GET /api/catalog/products debe devolver productos del seed.

## Notas de seguridad recomendadas

- No subir .env al repositorio.
- Restringir security group a una IP concreta (no 0.0.0.0/0).
- Para produccion, usar RDS sin acceso publico y backend dentro de VPC privada.
