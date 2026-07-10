const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const confirm = process.argv.includes('--confirm');

async function main() {
  const before = await prisma.$queryRawUnsafe(
    'SELECT role, isActive, COUNT(*) AS total FROM employees GROUP BY role, isActive ORDER BY role, isActive',
  );

  console.log('Estado actual de usuarios:');
  console.table(
    before.map((row) => ({
      role: row.role,
      isActive: Boolean(row.isActive),
      total: Number(row.total),
    })),
  );

  const targets = await prisma.$queryRawUnsafe(
    "SELECT id, username, role, name FROM employees WHERE role <> 'admin' AND isActive = 1 ORDER BY role, username",
  );

  if (!targets.length) {
    console.log('No hay usuarios activos no admin para desactivar.');
    return;
  }

  console.log('Usuarios no admin que se desactivaran:');
  console.table(
    targets.map((row) => ({
      id: Number(row.id),
      username: row.username,
      role: row.role,
      name: row.name,
    })),
  );

  if (!confirm) {
    console.log('Vista previa solamente. Ejecuta con --confirm para aplicar cambios.');
    return;
  }

  const ids = targets.map((row) => Number(row.id));
  const placeholders = ids.map(() => '?').join(', ');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE auth_sessions SET status = 'revoked', revokedAt = NOW(), revokedReason = 'admin_user_reset', updatedAt = NOW() WHERE employeeId IN (${placeholders}) AND status = 'active'`,
      ...ids,
    );
    await tx.$executeRawUnsafe(
      `UPDATE password_reset_tokens SET status = 'cancelled' WHERE employeeId IN (${placeholders}) AND status = 'pending'`,
      ...ids,
    );
    await tx.$executeRawUnsafe(
      `UPDATE auth_devices SET employeeId = NULL WHERE employeeId IN (${placeholders})`,
      ...ids,
    );
    await tx.$executeRawUnsafe(
      `UPDATE employee_roles SET isActive = 0 WHERE employeeId IN (${placeholders})`,
      ...ids,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM employee_permissions WHERE employeeId IN (${placeholders})`,
      ...ids,
    );
    await tx.$executeRawUnsafe(
      `UPDATE employees SET isActive = 0, updatedAt = NOW() WHERE id IN (${placeholders})`,
      ...ids,
    );
  });

  const after = await prisma.$queryRawUnsafe(
    'SELECT role, isActive, COUNT(*) AS total FROM employees GROUP BY role, isActive ORDER BY role, isActive',
  );

  console.log('Usuarios no admin desactivados y sesiones revocadas.');
  console.log('Estado final de usuarios:');
  console.table(
    after.map((row) => ({
      role: row.role,
      isActive: Boolean(row.isActive),
      total: Number(row.total),
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
