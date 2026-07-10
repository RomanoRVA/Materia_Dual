const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const initialProducts = [
  { name: 'Taco al Pastor', category: 'Tacos', price: 18.0 },
  { name: 'Taco de Bistec', category: 'Tacos', price: 20.0 },
  { name: 'Taco de Suadero', category: 'Tacos', price: 21.0 },
  { name: 'Quesadilla de Maiz', category: 'Especiales', price: 35.0 },
  { name: 'Gringa de Pastor', category: 'Especiales', price: 48.0 },
  { name: 'Volcan de Bistec', category: 'Especiales', price: 42.0 },
  { name: 'Agua de Horchata', category: 'Bebidas', price: 22.0 },
  { name: 'Agua de Jamaica', category: 'Bebidas', price: 22.0 },
  { name: 'Refresco 600ml', category: 'Bebidas', price: 24.0 },
  { name: 'Orden de Cebollitas', category: 'Extras', price: 28.0 },
];

const initialEmployees = [
  { username: 'admin1', accessCode: '200640', role: 'admin', name: 'Administrador' },
  { username: 'cajero1', accessCode: '100540', role: 'cashier', name: 'Caja Principal' },
];

async function main() {
  for (const product of initialProducts) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: {
        category: product.category,
        price: product.price,
        isActive: true,
      },
      create: {
        name: product.name,
        category: product.category,
        price: product.price,
        isActive: true,
      },
    });
  }

  for (const employee of initialEmployees) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO employees (username, accessCode, role, name, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        accessCode = VALUES(accessCode),
        role = VALUES(role),
        name = VALUES(name),
        isActive = 1,
        updatedAt = NOW()
      `,
      employee.username,
      employee.accessCode,
      employee.role,
      employee.name,
    );
  }

  console.log(`[seed] Productos iniciales cargados: ${initialProducts.length}`);
  console.log(`[seed] Empleados iniciales cargados: ${initialEmployees.length}`);
}

main()
  .catch((error) => {
    console.error('[seed] Error al poblar la base de datos:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
