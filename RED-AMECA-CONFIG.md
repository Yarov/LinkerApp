# Red Ameca - Configuracion de Red con Antenas Ubiquiti

**Fecha de auditoria:** 2026-03-28
**ISP:** Izzi (DOCSIS)
**Subred principal:** 192.168.1.0/24

---

## 1. Topologia de Red

```
                        INTERNET
                           |
                           v
                 +--------------------+
                 |   Modem Izzi       |
                 |   (DOCSIS Gateway) |
                 |   192.168.0.1      |
                 |   Red: 192.168.0.x |
                 +--------+-----------+
                          |
                          | Puerto ETH (192.168.0.119)
                          v
                 +--------------------+
                 |  Router Cisco      |
                 |  "Cisco53385"      |
                 |  192.168.1.1       |
                 |  DHCP Server       |
                 |  Red: 192.168.1.x  |
                 +--------+-----------+
                          |
               [SITIO: BASE G5]
                          |
                          | Cable Ethernet
                          v
                 +--------------------+
                 |  LiteAP GPS        |     ENLACE 5GHz - 3.15 km
                 |  "Linker AP"       |     SSID: "Linker"
                 |  192.168.1.200     |     Canal: 5180 MHz (20MHz)
                 |  Modo: Bridge/AP   | - - - - - - - - - - - - - +
                 |  Master (airMAX)   |                           |
                 +--------------------+                           |
                                                                  v
                                                +--------------------+
                                                |  LiteBeam 5AC      |
                                                |  "Rancho Alegre AC"|
                                                |  192.168.1.202     |
                                                |  Modo: Bridge/STA  |
                                                +--------+-----------+
                                                         |
                                              [SITIO: RANCHO ALEGRE]
                                                         |
                                                         | Cable Ethernet
                                                         v
                                                +--------------------+
                                                |  AP / Router WiFi  |
                                                |  (por identificar) |
                                                |  Distribuye WiFi   |
                                                |  a clientes locales|
                                                +--------+-----------+
                                                         |
                                              ??  Enlace a El Paraiso ??
                                                         |
                                                         v
                                                +--------------------+
                                                |  SITIO: EL PARAISO |
                                                |  (por validar)     |
                                                +--------------------+
```

---

## 2. Inventario de Equipos

### 2.1 Base G5

| Equipo | IP | MAC | Modelo | Firmware | Rol |
|--------|-----|-----|--------|----------|-----|
| Modem Izzi | 192.168.0.1 | c4:eb:42:71:91:ff | DOCSIS Gateway | - | WAN/Internet |
| Router Cisco | 192.168.1.1 | 20:aa:4b:d8:1d:d4 | Cisco53385 (CyberTAN) | - | Gateway LAN / DHCP |
| LiteAP GPS | 192.168.1.200 | f4:e2:c6:90:53:5d | LAP-GPS (L5C) | WA.v8.7.19 | AP Master (airMAX) |

### 2.2 Rancho Alegre

| Equipo | IP | MAC | Modelo | Firmware | Rol |
|--------|-----|-----|--------|----------|-----|
| LiteBeam 5AC | 192.168.1.202 | 9c:05:d6:8a:33:54 | LBE-5AC | WA.v8.7.15 | Station (Bridge) |
| Ubiquiti (?) | 192.168.1.10 | a8:42:a1:b4:b8:d5 | Por identificar | - | AP hacia El Paraiso? |
| Ubiquiti (?) | - | 9c:05:d6:8a:72:b3 | Por identificar | - | Enlace a El Paraiso? |
| Ubiquiti (?) | - | 9c:05:d6:9a:8e:1b | Por identificar | - | Por identificar |

### 2.3 Clientes DHCP activos (detras de Rancho Alegre)

| Hostname | IP | MAC | Tipo |
|----------|-----|-----|------|
| TL-WR840N | 192.168.1.100 | 20:23:51:87:a6:ca | Router WiFi TP-Link |
| TL-WR840N | 192.168.1.104 | 20:23:51:4e:ca:77 | Router WiFi TP-Link |
| DESKTOP-ORT3KS1 | 192.168.1.102 | 68:94:23:67:88:49 | PC Windows |
| (sin nombre) | 192.168.1.103 | 34:17:36:74:08:44 | Dispositivo |
| Galaxy-A15 | 192.168.1.106 | 8a:30:3a:27:af:bf | Celular Samsung |
| Android | 192.168.1.105 | a0:41:47:98:69:e4 | Celular Android |

---

## 3. Problemas Encontrados

### CRITICO - Seguridad WiFi
- **Enlace "Linker" sin encriptacion:** `wireless.1.security.type=none`
- Cualquier equipo con antena 5GHz en rango puede conectarse
- **Accion:** Configurar WPA2-AES con clave fuerte en ambos extremos (LiteAP + LiteBeam)

### CRITICO - Nodos inalcanzables por IP
- 192.168.1.202 (Rancho Alegre): conectado por airMAX pero **no responde ping/SSH**
- 192.168.1.10 (Ubiquiti): MAC visible en bridge pero **no responde a nada**
- ARP muestra `00:00:00:00:00:00` = firewall bloqueando o IP mal configurada
- **Accion:** Acceder fisicamente o resetear para reconfigurar

### ALTO - Firmware desactualizado
- LiteBeam "Rancho Alegre": **v8.7.15** (enero 2025)
- LiteAP GPS "Base G5": **v8.7.19** (actual)
- **Accion:** Actualizar LiteBeam a v8.7.19 para compatibilidad airMAX

### MEDIO - Doble NAT
- Modem Izzi (192.168.0.x) -> Router Cisco (192.168.1.x)
- Agrega latencia y complejidad
- **Accion:** Si el modem Izzi lo permite, ponerlo en modo bridge

### MEDIO - 2 routers TP-Link TL-WR840N en la red
- IPs: 192.168.1.100 y 192.168.1.104
- Si estan en modo router (no AP), crean sub-redes adicionales y causan doble/triple NAT
- **Accion:** Verificar que esten en modo AP o bridge, no router

### BAJO - DNS corregido
- **Antes:** DNS del ISP (192.168.0.1) - inaccesible desde nodos remotos
- **Ahora:** DNS publicos (8.8.8.8, 1.1.1.1, 8.8.4.4) - accesibles desde cualquier punto
- **Estado:** RESUELTO (2026-03-28)

---

## 4. Configuracion Correcta por Equipo

### 4.1 Modem Izzi (192.168.0.1)

**Configuracion ideal:** Modo Bridge (si Izzi lo permite)
- Elimina el doble NAT
- El Router Cisco recibe IP publica directamente
- Si no se puede poner en bridge, dejar como esta

### 4.2 Router Cisco "Cisco53385" (192.168.1.1)

**Rol:** Gateway principal / DHCP Server

| Parametro | Valor Correcto |
|-----------|---------------|
| LAN IP | 192.168.1.1 |
| Subnet Mask | 255.255.255.0 |
| DHCP | Habilitado |
| DHCP Start | 192.168.1.100 |
| DHCP Range | 50 clientes (100-149) |
| DNS 1 | 8.8.8.8 |
| DNS 2 | 1.1.1.1 |
| DNS 3 | 8.8.4.4 |
| WAN | DHCP (desde modem Izzi) |
| Password admin | **CAMBIAR de admin:admin** |

**NOTA:** El acceso web actual es admin:admin - DEBE cambiarse.

**Reservas DHCP recomendadas** (IPs fijas fuera del rango DHCP):

| Equipo | IP Reservada |
|--------|-------------|
| Router Cisco (gateway) | 192.168.1.1 |
| LiteAP GPS (Base G5) | 192.168.1.200 |
| LiteBeam (Rancho Alegre) | 192.168.1.201 |
| AP El Paraiso (enlace) | 192.168.1.202 |
| AP El Paraiso (distribucion) | 192.168.1.203 |
| Ubiquiti reserva 1 | 192.168.1.210 |
| Ubiquiti reserva 2 | 192.168.1.211 |

**Esquema de IPs recomendado:**

```
192.168.1.1         = Gateway (Router Cisco)
192.168.1.2-99      = Reservado para IPs estaticas de infraestructura
192.168.1.100-199   = Pool DHCP para clientes (computadoras, celulares)
192.168.1.200-220   = Antenas Ubiquiti y equipos de red (IPs estaticas)
192.168.1.250-254   = Equipos de administracion/monitoreo
```

### 4.3 LiteAP GPS "Linker AP" - Base G5 (192.168.1.200)

**Rol:** Access Point Master (airMAX) - Antena base

| Parametro | Valor Actual | Valor Correcto |
|-----------|-------------|----------------|
| Hostname | Linker AP | **Base-G5** |
| IP | 192.168.1.200 (estatica) | 192.168.1.200 |
| Netmask | 255.255.255.0 | 255.255.255.0 |
| Gateway | 192.168.1.1 | 192.168.1.1 |
| DNS | 1.1.1.1 | 8.8.8.8 |
| Modo de red | Bridge | Bridge |
| Modo wireless | AP Master | AP Master |
| SSID | Linker | Linker (o nombre descriptivo) |
| Seguridad | **NINGUNA** | **WPA2-AES** |
| Frecuencia | 5180 MHz | 5180 MHz (verificar interferencia) |
| Ancho de canal | 20 MHz | 40 MHz (si el enlace lo permite) |
| Potencia TX | 25 dBm | 25 dBm |
| airMAX | Habilitado | Habilitado |
| airMAX Priority | 2 (High) | 2 (High) |
| Polling | Habilitado | Habilitado |
| DFS | Habilitado | Habilitado |
| ACK Auto | Habilitado | Habilitado |
| WDS | Habilitado | Habilitado |
| STP | Deshabilitado | **Habilitado** (previene loops) |
| Firmware | WA.v8.7.19 | WA.v8.7.19 (actual) |
| HTTPS | Deshabilitado | **Habilitado** |
| Telnet | Deshabilitado | Deshabilitado |
| SNMP | Deshabilitado | Deshabilitado |
| SSH | Habilitado | Habilitado |
| Password | ubnt/Blaster9615* | **Cambiar password default** |

### 4.4 LiteBeam 5AC "Rancho Alegre AC" (192.168.1.201 recomendado)

**Rol:** Station Bridge - Receptor del enlace desde Base G5

| Parametro | Valor Actual | Valor Correcto |
|-----------|-------------|----------------|
| Hostname | Rancho Alegre AC | Rancho-Alegre |
| IP | 192.168.1.202 | 192.168.1.201 (estatica) |
| Netmask | 255.255.255.0 | 255.255.255.0 |
| Gateway | 192.168.1.1 | 192.168.1.1 |
| DNS | (verificar) | 8.8.8.8 |
| Modo de red | Bridge | Bridge |
| Modo wireless | Station (sta-ptmp) | Station |
| SSID | Linker | Linker (debe coincidir con AP) |
| Seguridad | (verificar) | **WPA2-AES** (misma clave que AP) |
| Distancia | 3000m configurado / 3150m real | 3200m |
| Potencia TX | 15 dBm (ATPC) | Auto (ATPC habilitado) |
| Firmware | **WA.v8.7.15** | **ACTUALIZAR a v8.7.19** |
| Senal | -55 dBm | Aceptable (ideal < -60) |
| Ruido | -87 dBm | OK |
| Ethernet | 100 Mbps Full Duplex | OK |

### 4.5 AP en Rancho Alegre (distribucion local / enlace a El Paraiso)

**Pendiente de identificar.** Hay al menos 3 equipos Ubiquiti con MACs:
- a8:42:a1:b4:b8:d5 (IP 192.168.1.10 - no responde)
- 9c:05:d6:8a:72:b3 (IP desconocida)
- 9c:05:d6:9a:8e:1b (IP desconocida)

**Configuracion recomendada para AP de distribucion WiFi:**

| Parametro | Valor |
|-----------|-------|
| Modo de red | Bridge |
| IP | 192.168.1.202-203 (estatica) |
| Gateway | 192.168.1.1 |
| DNS | 8.8.8.8 |
| SSID | (nombre de la zona, ej: "Paraiso-WiFi") |
| Seguridad | WPA2-AES |
| Canal | Diferente al del enlace backbone (evitar 5180) |

### 4.6 Routers TP-Link TL-WR840N

**Hay 2 en la red** (192.168.1.100 y 192.168.1.104).

**Configuracion recomendada:**

| Parametro | Valor |
|-----------|-------|
| Modo | **AP (Access Point)** - NO router |
| DHCP | **Deshabilitado** (el DHCP lo da el Cisco) |
| IP | Estatica dentro del rango 192.168.1.x |
| Gateway | 192.168.1.1 |
| DNS | 8.8.8.8, 1.1.1.1 |

**Si estan en modo Router:** Crean una sub-red separada (192.168.2.x o similar). Los clientes detras de ellos tendran doble NAT y problemas de conectividad. DEBEN estar en modo AP/Bridge.

---

## 5. Enlace Base G5 <-> Rancho Alegre - Metricas

| Metrica | Valor | Estado |
|---------|-------|--------|
| Distancia | 3.15 km | OK |
| Senal DL (G5 -> RA) | -55 dBm | Buena |
| Senal UL (RA -> G5) | -61 dBm | Aceptable |
| Ruido | -87/-88 dBm | OK |
| Capacidad airMAX | ~120 Mbps | OK |
| DL Capacity | ~95-112 Mbps | OK |
| UL Capacity | ~143 Mbps | Buena |
| Link Score DL | 58-72% | **Mejorable** |
| Link Score UL | 92% | Bueno |
| Protocolo | 802.11ac (VHT20) | Podria ser VHT40 |
| TX Rate AP | 48-144 Mbps | Variable |
| RX Rate AP | 173.3 Mbps | OK |
| Uptime enlace | ~6.9 dias | Estable |

**Para mejorar el enlace:**
- Subir ancho de canal de 20 a 40 MHz (duplica throughput teorico)
- Verificar alineacion fisica de antenas (DL score bajo = posible desalineacion)
- Actualizar firmware del LiteBeam para mejor compatibilidad airMAX

---

## 6. Plan de Accion (Priorizado)

### Inmediato (critico)
1. [ ] **Activar WPA2-AES** en el enlace "Linker" (ambos extremos: LiteAP + LiteBeam)
2. [ ] **Cambiar password del router Cisco** (actualmente admin:admin)
3. [ ] **Acceder fisicamente a Rancho Alegre** para diagnosticar equipos inalcanzables

### Corto plazo (1 semana)
4. [ ] **Actualizar firmware** del LiteBeam a v8.7.19
5. [ ] **Identificar y configurar** los 3 equipos Ubiquiti desconocidos en Rancho Alegre
6. [ ] **Verificar TP-Links** esten en modo AP, no router
7. [ ] **Asignar IPs estaticas** a todos los equipos de infraestructura segun esquema
8. [ ] **Validar enlace a El Paraiso** - identificar equipo y configuracion

### Medio plazo
9. [ ] **Poner modem Izzi en bridge** (eliminar doble NAT)
10. [ ] **Habilitar STP** en los bridges (prevenir loops de red)
11. [ ] **Habilitar HTTPS** en equipos Ubiquiti (actualmente HTTP plano)
12. [ ] **Evaluar** subir ancho de canal a 40 MHz en enlace backbone
13. [ ] **Documentar** passwords en gestor seguro (no dejar defaults)

---

## 7. Credenciales Actuales (CAMBIAR TODAS)

| Equipo | Usuario | Password | Acceso |
|--------|---------|----------|--------|
| Router Cisco 192.168.1.1 | admin | admin | HTTP :80 |
| LiteAP GPS 192.168.1.200 | ubnt | Blaster9615* | SSH :22 / HTTP :80 |
| LiteBeam (Rancho Alegre) | ubnt | Blaster9615* (probable) | SSH :22 / HTTP :80 |

**IMPORTANTE:** Cambiar TODAS las credenciales por defecto. Usar passwords unicos por equipo.

---

## 8. Diagrama de Frecuencias y Canales

```
Base G5 (LiteAP GPS)          Rancho Alegre                  El Paraiso
     |                              |                              |
     |  5180 MHz (canal 36)         |                              |
     |  20 MHz ancho                |                              |
     |  SSID: Linker                |                              |
     |  airMAX Master               |                              |
     | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~>|                              |
     |                              |                              |
     |                              |  ???? MHz                    |
     |                              |  SSID: ????                  |
     |                              | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~>|
     |                              |                              |
     |                              |  2.4 GHz (TP-Links)          |
     |                              |  WiFi local clientes         |
```

**Regla:** Los enlaces backbone (punto a punto) deben usar canales 5GHz diferentes entre si. El WiFi de distribucion local puede usar 2.4GHz.

---

## 9. Contacto y Notas

- Red gestionada desde: /Users/yarov/projects/redAmeca
- Ultima revision: 2026-03-28
- Proximo paso critico: Visita fisica a Rancho Alegre para configurar equipos inalcanzables
