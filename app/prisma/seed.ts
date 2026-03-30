import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const dbPath = path.resolve(process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.alert.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.client.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.node.deleteMany();

  // Create Nodes - matching actual network topology
  const mikrotik = await prisma.node.create({
    data: {
      name: "MikroTik Router",
      type: "ROUTER",
      ip: "192.168.1.1",
      model: "RB750Gr3",
      firmware: "RouterOS 7.18.2",
      status: "ONLINE",
      lastSeen: new Date(),
    },
  });

  const baseG5 = await prisma.node.create({
    data: {
      name: "Base-G5",
      type: "AP",
      ip: "192.168.1.200",
      model: "LiteAP GPS",
      firmware: "WA.v8.7.15",
      latitude: 19.1236,
      longitude: -98.7635,
      parentId: mikrotik.id,
      status: "ONLINE",
      lastSeen: new Date(),
    },
  });

  const ranchoAlegre = await prisma.node.create({
    data: {
      name: "Rancho-Alegre",
      type: "STATION",
      ip: "192.168.1.201",
      model: "LiteBeam 5AC Gen2",
      firmware: "WA.v8.7.15",
      latitude: 19.128,
      longitude: -98.7362,
      parentId: baseG5.id,
      status: "ONLINE",
      lastSeen: new Date(),
    },
  });

  await prisma.node.create({
    data: {
      name: "LinkerLoco",
      type: "DISTRIBUTION",
      ip: "192.168.1.202",
      model: "LiteBeam 5AC Gen2",
      parentId: ranchoAlegre.id,
      status: "OFFLINE",
    },
  });

  await prisma.node.create({
    data: {
      name: "TP-Link Rancho Alegre",
      type: "CPE",
      ip: "192.168.1.100",
      model: "TP-Link CPE",
      parentId: ranchoAlegre.id,
      status: "ONLINE",
      lastSeen: new Date(),
    },
  });

  // Create Plans - matching MikroTik PPPoE profiles already configured
  await prisma.plan.create({
    data: {
      name: "Plan 10 Mbps",
      downloadMbps: 10,
      uploadMbps: 10,
      price: 350,
      profileName: "plan-10M",
      isActive: true,
    },
  });

  await prisma.plan.create({
    data: {
      name: "Plan 20 Mbps",
      downloadMbps: 20,
      uploadMbps: 20,
      price: 500,
      profileName: "plan-20M",
      isActive: true,
    },
  });

  await prisma.plan.create({
    data: {
      name: "Ilimitado",
      downloadMbps: 100,
      uploadMbps: 100,
      price: 0,
      profileName: "plan-ilimitado",
      isActive: true,
    },
  });

  console.log("Seed completed successfully!");
  console.log("  Nodes: 5");
  console.log("  Plans: 3");
  console.log("  Clients: 0 (create through the app)");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
