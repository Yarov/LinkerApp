# Guia de Configuracion - LiteBeam 5AC "Rancho Alegre"

## Datos del equipo
- **Modelo**: LiteBeam 5AC (LBE-5AC)
- **IP actual**: 192.168.1.202 (puede haber cambiado)
- **MAC**: 9C:05:D6:8A:33:54
- **Firmware actual**: WA.v8.7.15 (actualizar a v8.7.19)
- **Credenciales**: ubnt / Blaster9615*

---

## Antes de ir: Llevar

- [ ] Laptop con cable Ethernet (o adaptador USB-C a Ethernet)
- [ ] Firmware v8.7.19 descargado: https://www.ui.com/download/software/airmax-ac
- [ ] Esta guia

---

## Paso 1: Conectarse al LiteBeam

El LiteBeam esta en Rancho Alegre. Necesitas acceder fisicamente al PoE injector.

1. Conecta un cable Ethernet de tu laptop al puerto **LAN** del PoE injector del LiteBeam
2. Configura tu laptop con IP estatica:
   - IP: 192.168.1.100
   - Mascara: 255.255.255.0
   - Gateway: 192.168.1.1
3. Abre el navegador en: **http://192.168.1.202**
4. Si no responde, prueba **http://192.168.1.20** (IP default Ubiquiti)
5. Login: **ubnt** / **Blaster9615***

Si no puedes acceder, resetea el LiteBeam presionando el boton de reset 10 segundos.
Despues del reset la IP sera **192.168.1.20** con credenciales **ubnt/ubnt**.

---

## Paso 2: Actualizar firmware (si esta en v8.7.15)

1. En la web UI, ve a **System** (tab superior)
2. En la seccion **Firmware Update**, haz clic en **Upload Firmware**
3. Selecciona el archivo `WA.v8.7.19.xxxxx.bin` que descargaste
4. Espera a que actualice y reinicie (~2-3 minutos)
5. Vuelve a entrar en http://192.168.1.202

---

## Paso 3: Configurar Wireless

En la tab **Wireless**:

| Parametro | Valor |
|-----------|-------|
| Wireless Mode | Station |
| SSID | Linker (clic en Select y buscar la red) |
| Lock to AP MAC | Activar y poner: **F4:E2:C6:90:53:5D** |
| Security | WPA2-AES |
| WPA Preshared Key | **Blaster9615*** |
| Frequency | 5180 MHz (debe coincidir con el AP) |
| Channel Width | 40 MHz |
| Output Power | Auto (ATPC habilitado) |

**IMPORTANTE**: El SSID "Linker" ahora tiene WPA2 activado. Sin la clave correcta no se conectara.

Haz clic en **Change** y luego **Apply**.

---

## Paso 4: Configurar Network

En la tab **Network**:

| Parametro | Valor |
|-----------|-------|
| Network Mode | Bridge |
| IP Address | **192.168.1.201** (cambiar de .202 a .201) |
| Netmask | 255.255.255.0 |
| Gateway | 192.168.1.1 |
| DNS | 8.8.8.8 |

Haz clic en **Change** y luego **Apply**.

**NOTA**: Al cambiar la IP a .201, tendras que reconectarte en http://192.168.1.201

---

## Paso 5: Configurar System

En la tab **System**:

| Parametro | Valor |
|-----------|-------|
| Device Name | **Rancho-Alegre** |
| Date Format | Activar NTP Client |
| NTP Server | 0.ubnt.pool.ntp.org |
| Timezone | (GMT-06:00) America/Mexico_City |

**Cambiar password:**
- Poner un password nuevo y seguro (diferente del default)
- Anotarlo en un lugar seguro

Haz clic en **Change** y luego **Apply**.

---

## Paso 6: Verificar enlace

Despues de aplicar todo:

1. En la tab **Main**, verifica:
   - **Signal Strength**: debe ser entre -50 y -65 dBm
   - **airMAX Quality**: debe ser > 80%
   - **TX/RX Rate**: deberia mostrar tasas VHT40 (hasta 300 Mbps)
   - **Connection Time**: debe ir subiendo (enlace estable)

2. Prueba de velocidad: en **Tools > Speed Test**, selecciona el AP (Base-G5) y ejecuta

3. Prueba internet: en **Tools > Ping**, haz ping a 8.8.8.8 para verificar que hay internet

---

## Paso 7: Verificar desde remoto

Una vez que el LiteBeam se conecte al AP Base-G5, deberia ser accesible desde la VPN.

Desde tu Mac (con VPN activa):
```bash
# Levantar VPN si no esta activa
sudo wg-quick up /Users/yarov/projects/redAmeca/wg-ameca.conf

# Verificar que la antena AP responde
ping 192.168.1.200

# Verificar que el LiteBeam responde (nueva IP)
ping 192.168.1.201

# Acceder al LiteBeam por web
open http://192.168.1.201

# Acceder al MikroTik
open http://10.10.10.3
```

---

## Resumen de IPs de la red

| Equipo | IP | Rol |
|--------|-----|-----|
| MikroTik-Ameca | 192.168.1.1 / 10.10.10.3 | Gateway / Router |
| LiteAP GPS (Base-G5) | 192.168.1.200 | AP Master (antena base) |
| LiteBeam 5AC (Rancho Alegre) | 192.168.1.201 | Station (receptor enlace) |
| LiteBeam/AP El Paraiso | 192.168.1.202 | Por configurar |
| Reserva Ubiquiti | 192.168.1.203-220 | Futuros equipos |

---

## Datos del enlace WiFi

| Parametro | Valor |
|-----------|-------|
| SSID | Linker |
| Seguridad | WPA2-AES (CCMP) |
| Clave | Blaster9615* |
| Frecuencia | 5180 MHz |
| Ancho canal | 40 MHz |
| AP MAC | F4:E2:C6:90:53:5D |
| Distancia | ~3.15 km |

---

## Troubleshooting

**No puedo acceder al LiteBeam por web:**
- Verifica que el PoE injector tiene LED encendido
- Prueba con IP 192.168.1.20 (default)
- Resetea con boton 10 seg, luego configura desde cero

**El LiteBeam no se conecta al AP:**
- Verifica SSID = "Linker" (exacto, case-sensitive)
- Verifica clave WPA2 = "Blaster9615*" (con asterisco)
- Verifica frecuencia 5180 MHz y ancho 40 MHz
- Usa "Lock to AP" con MAC F4:E2:C6:90:53:5D

**Hay enlace pero no hay internet:**
- Verifica modo Bridge (no Router)
- Verifica gateway 192.168.1.1
- Desde Tools > Ping, haz ping a 192.168.1.1 (gateway) y luego 8.8.8.8

**Senal baja (peor que -65 dBm):**
- Verificar alineacion fisica de la antena hacia Base G5
- Verificar que no haya obstrucciones nuevas en la linea de vista
