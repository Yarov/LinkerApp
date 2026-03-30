# Linker - WISP Manager

Sistema de gestion para proveedores de internet inalambrico (WISP).

## Stack

- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Backend**: API Routes de Next.js
- **Base de datos**: SQLite via Prisma
- **Integracion**: MikroTik RouterOS API + Ubiquiti airOS SSH
- **VPN**: WireGuard hub-spoke para acceso remoto

## Funcionalidades actuales

- Dashboard con estado de red en tiempo real (ping a nodos desde MikroTik)
- Gestion de clientes con PPPoE automatico (crear cliente = crear PPPoE secret en MikroTik)
- Planes de velocidad sincronizados con PPPoE profiles del MikroTik
- Suspender/activar servicio con un clic (deshabilita PPPoE en MikroTik)
- Registro de pagos y deteccion de morosos
- Monitoreo de nodos con alertas automaticas (caidas, recuperaciones, pagos vencidos)
- Vista de topologia de red
- Estado del sistema MikroTik (CPU, memoria, uptime, sesiones PPPoE)
- Autenticacion por sesion (cookie)

## Configuracion

```bash
cd app
npm install
npx prisma db push
npx prisma db seed
npm run dev
```

### Variables de entorno (.env)

```
DATABASE_URL=file:./dev.db
MIKROTIK_HOST=10.10.10.3
MIKROTIK_PORT=8728
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=
ANTENNA_USER=ubnt
ANTENNA_PASSWORD=Blaster9615*
ADMIN_USER=admin
ADMIN_PASSWORD=linker2026
```

## Credenciales

- **App**: admin / linker2026
- **MikroTik**: admin / (vacio) via VPN 10.10.10.3
- **Antenas Ubiquiti**: ubnt / Blaster9615*

## Red actual (Red Ameca)

```
Internet (Izzi) --> MikroTik RB750Gr3 (192.168.1.1)
                        |
                    LiteAP GPS "Base-G5" (192.168.1.200)
                        |  3.15 km
                    LiteBeam "Rancho-Alegre" (192.168.1.201)
                        |
                      SWITCH (pendiente)
                        |
                    +---+---+
                    |       |
                TP-Link   NanoLoco "LinkerLoco"
                (.100)    (192.168.1.210)
                           |
                     +-----+-----+
                     |           |
                  Cliente 1   Cliente 2
                  (PPPoE)     (PPPoE)
```

## VPN WireGuard

```
Mac (10.10.10.2) <--> VPS 84.46.246.220 (10.10.10.1) <--> MikroTik (10.10.10.3)
```

Aliases en ~/.zshrc: `vpn-up`, `vpn-down`, `vpn-status`

---

# ROADMAP: Linker como producto SaaS comercial

## Vision

Convertir Linker en una plataforma SaaS multi-tenant para que cualquier WISP en Latinoamerica pueda gestionar su red, clientes y facturacion desde la nube.

## Problema de mercado

- Las herramientas existentes (UISP, Splynx, Wispro) son caras ($50-200 USD/mes) o complejas
- Miles de WISPs pequenos en Mexico y LATAM operan con Excel y WhatsApp
- No hay solucion que combine: gestion de red + facturacion + control de acceso en una sola app simple

## Modelo de negocio

| Plan | Precio | Clientes | Features |
|------|--------|----------|----------|
| Gratis | $0 | Hasta 10 | Dashboard, monitoreo, PPPoE basico |
| Basico | $299 MXN/mes | Hasta 50 | + Alertas Telegram, reportes, portal cliente |
| Pro | $599 MXN/mes | Ilimitado | + WhatsApp, app movil, soporte prioritario |
| Enterprise | Contactar | Custom | + Multi-sitio, API, white-label |

## Arquitectura SaaS

```
                    ┌──────────────────────────┐
                    │    Linker Cloud (VPS)     │
                    │                           │
                    │  Next.js + PostgreSQL      │
                    │  Multi-tenant (tenant_id)  │
                    │  WireGuard Hub             │
                    │  Stripe/MercadoPago        │
                    │                           │
                    └─────┬───────┬───────┬─────┘
                          │       │       │
                     WireGuard  WireGuard  WireGuard
                          │       │       │
                    MikroTik A  MikroTik B  MikroTik C
                    (WISP 1)   (WISP 2)   (WISP 3)
```

## Features del producto comercial

### Fase 1: MVP SaaS
- [ ] Multi-tenant con PostgreSQL (migrar de SQLite)
- [ ] Registro de WISPs con plan/subscripcion
- [ ] Onboarding wizard: script para MikroTik que conecta WireGuard automaticamente
- [ ] Auto-discovery: detectar PPPoE existente, queues, clientes al conectar MikroTik
- [ ] Dashboard por tenant aislado
- [ ] Deploy en Docker Compose en VPS

### Fase 2: Crecimiento
- [ ] Alertas por Telegram bot (nodo caido, pago vencido, cliente nuevo)
- [ ] Portal de cliente: el usuario final ve su consumo, plan, y estado de pago
- [ ] Pagos en linea (MercadoPago/Stripe) - el cliente paga desde el portal
- [ ] Auto-corte inteligente: 3 dias de gracia, aviso por WhatsApp, luego corte
- [ ] Reportes: ingresos mensuales, clientes por plan, uptime de red
- [ ] App movil (React Native o Capacitor)

### Fase 3: Escalamiento
- [ ] API publica para integraciones
- [ ] White-label (el WISP pone su logo y dominio)
- [ ] Multi-sitio (un WISP con varias torres)
- [ ] Marketplace de routers pre-configurados
- [ ] Soporte para Mikrotik + OLT (fibra optica)

## Diferenciadores clave

1. **Setup en 5 minutos**: script en MikroTik, conecta, auto-detecta, listo
2. **Precio accesible**: desde gratis, enfocado en LATAM
3. **Todo en uno**: red + clientes + cobros en una sola app
4. **Sin hardware especial**: funciona con cualquier MikroTik que ya tenga el WISP
5. **Espanol nativo**: no es una traduccion, se penso en espanol desde el dia 1

## Competencia

| Herramienta | Precio | Fortaleza | Debilidad |
|------------|--------|-----------|-----------|
| UISP (Ubiquiti) | Gratis | Monitoreo de antenas | No maneja facturacion ni PPPoE |
| Splynx | $50+ USD/mes | Completo | Caro, complejo, en ingles |
| Wispro | ~$30 USD/mes | Facturacion LATAM | No controla MikroTik directo |
| MikroTik Dude | Gratis | Monitoreo | Solo monitoreo, sin facturacion |
| **Linker** | Desde $0 | Simple, todo en uno, LATAM | Nuevo, en desarrollo |

## Stack para version SaaS

- **Frontend**: Next.js (mismo, pero con multi-tenant routing)
- **Backend**: Next.js API Routes o migrar a FastAPI si escala
- **Base de datos**: PostgreSQL con Row Level Security por tenant
- **Auth**: NextAuth.js con magic link o Google
- **Pagos**: Stripe + MercadoPago
- **VPN**: WireGuard auto-provisioning por tenant
- **Deploy**: Docker Compose, luego Kubernetes cuando escale
- **Monitoreo**: Grafana + Prometheus para metricas internas

## Metricas objetivo (primer ano)

- 50 WISPs registrados
- 10 WISPs pagando (plan Basico o Pro)
- 500+ clientes finales gestionados a traves de Linker
- MRR: $5,000 MXN/mes

---

*Este documento fue creado el 2026-03-29. Retomar cuando la version actual este estable y operando con al menos 10 clientes reales.*
