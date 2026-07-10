const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const repair = process.argv.includes('--repair');

async function main() {
  const grouped = await prisma.$queryRawUnsafe(`
    SELECT
      paidDay,
      CASE WHEN cutReference IS NULL THEN 'open' ELSE 'cut' END AS status,
      COUNT(*) AS ordersCount,
      COALESCE(SUM(total), 0) AS revenue
    FROM sales
    GROUP BY paidDay, status
    ORDER BY paidDay DESC, status ASC
  `);

  console.log('Resumen actual de ventas:');
  console.table(
    grouped.map((row) => ({
      paidDay: row.paidDay,
      status: row.status,
      ordersCount: Number(row.ordersCount),
      revenue: Number(row.revenue),
    })),
  );

  const staleRows = await prisma.$queryRawUnsafe(`
    SELECT
      s.id,
      s.orderId,
      s.paidDay,
      s.total,
      s.paidAt,
      s.cutReference,
      dc.createdAt AS cutCreatedAt
    FROM sales s
    INNER JOIN daily_cuts dc ON dc.reference = s.cutReference
    WHERE s.cutReference IS NOT NULL
      AND s.paidAt > dc.createdAt
    ORDER BY s.paidAt DESC, s.orderId DESC
  `);

  if (!staleRows.length) {
    console.log('No se detectaron ventas con corte viejo posterior al pago.');
    return;
  }

  console.log('Ventas que parecen quedar atoradas con corte viejo:');
  console.table(
    staleRows.map((row) => ({
      id: Number(row.id),
      orderId: Number(row.orderId),
      paidDay: row.paidDay,
      total: Number(row.total),
      paidAt: row.paidAt,
      cutReference: row.cutReference,
      cutCreatedAt: row.cutCreatedAt,
    })),
  );

  if (!repair) {
    console.log('Vista previa solamente. Ejecuta con --repair para reabrir estas ventas al corte actual.');
    return;
  }

  const ids = staleRows.map((row) => Number(row.id));
  const placeholders = ids.map(() => '?').join(', ');
  await prisma.$executeRawUnsafe(
    `UPDATE sales SET cutReference = NULL WHERE id IN (${placeholders})`,
    ...ids,
  );

  console.log(`${ids.length} venta(s) reabierta(s) para el corte actual.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
