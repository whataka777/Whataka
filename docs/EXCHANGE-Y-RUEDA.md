# Compra-venta dentro de la app + comisión: la "rueda"

Idea del usuario: en vez de quemar, montar una **rueda**: permitir **comprar y
vender WTK dentro de la misma app**, **solo contra USDT**, y **cobrar una
comisión** (fee) por cada operación.

Respuesta corta: **la idea económica es buena** (una "rueda" de volumen puede
hacer subir el valor), **pero montar ese mercado en tu propia app es una
actividad regulada**. En la Unión Europea necesitas **licencia MiCA (CASP)**.
Abajo está el porqué, con la ley en la mano.

---

## 1. La parte buena: la "rueda" (flywheel)

La idea de una rueda es **correcta y potente**. Es como funciona todo el DeFi:

```
Más gente compra WTK  →  el precio sube
        ↑                        ↓
   la app gana valor  ←  más gente quiere entrar
        ↑                        ↓
   comisiones (fees)  ←  más gente compra y vende
```

- **Comprar y vender** crea **liquidez** y **volumen**.
- **Más volumen** = el token se mueve, se conoce y sube.
- **La comisión** te da **ingresos** sin quemar nada.
- **Solo contra USDT** es sensato: USDT es una moneda estable (1 USDT ≈ 1 $),
  así el precio del WTK se mide en dólares y no en otra cripto volátil.

Los ingresos por comisión (con `scripts/simulador-fees.js`):

| Usuarios | Ops/mes | Ticket | Volumen/mes | Ingreso/mes |
| --- | --- | --- | --- | --- |
| 100 | 2 | 10 $ | 2.000 $ | 6 $ |
| 1.000 | 2 | 10 $ | 20.000 $ | 60 $ |
| 10.000 | 3 | 20 $ | 600.000 $ | 1.800 $ |
| 50.000 | 4 | 25 $ | 5.000.000 $ | 15.000 $ |
| 100.000 | 5 | 30 $ | 15.000.000 $ | 45.000 $ |

**Lección:** las comisiones solo dan dinero si **hay volumen**. Sin usuarios que
compren y vendan, la rueda **no gira**: se queda parada.

---

## 2. El problema: eso es un "proveedor de servicios de criptoactivos"

Aquí está el muro. **Montar una plataforma para comprar y vender criptoactivos
por cuenta de clientes es un servicio regulado.** Lo dice el **Reglamento
europeo MiCA** (Reglamento UE 2023/1114), texto oficial:

> *"Una primera categoría de servicios consiste en **asegurar el funcionamiento
> de una plataforma de negociación de criptoactivos**, **canjear criptoactivos
> por fondos** o por otros criptoactivos, prestar servicios de custodia..."*

> *"Toda persona que preste **profesionalmente** servicios de criptoactivos de
> conformidad con el presente Reglamento debe considerarse un **«proveedor de
> servicios de criptoactivos»**."*

En español claro: **si tu app permite comprar y vender WTK, y tú cobras por ello,
eres un CASP y necesitas autorización.**

### Cuánto capital te exige MiCA (Anexo IV, texto oficial)

| Clase | Servicios | Capital inicial mínimo |
| --- | --- | --- |
| **Clase 1** | Ejecución de órdenes, colocación, transferencia, asesoramiento | **50.000 €** |
| **Clase 2** | Clase 1 + custodia + **canje de criptoactivos por fondos** | **125.000 €** |
| **Clase 3** | Clase 2 + **gestión de una plataforma de negociación** | **150.000 €** |

Tu idea ("comprar y vender dentro de la app") es **Clase 3** → **150.000 € de
capital** + autorización de la CNMV + cumplimiento (KYC, blanqueo, etc.).

### Las multas si lo haces sin licencia (texto oficial de MiCA)
- Persona física: hasta **1.000.000 €** (o **5.000.000 €** en infracciones graves).
- Persona jurídica: hasta **15.000.000 € o el 15 % del volumen de negocio**.

---

## 3. ¿Y si no lo hago yo, sino que uso un DEX?

Existe un atajo: **no montas el mercado tú**, sino que **usas un DEX** (exchange
descentralizado) que ya funciona en Polygon, como **QuickSwap**.

Tú solo **muestras un botón** ("Comprar WTK") que abre la web del DEX o conecta
su "widget". El DEX hace la operación; tú **no custodias** el dinero ni ejecutas
la orden.

| | Mercado propio en la app | Botón hacia un DEX |
| --- | --- | --- |
| **Licencia** | Sí (CASP, 150.000 €) | Normalmente **no** |
| **Custodia** | Tú guardas los fondos | El DEX / el usuario |
| **Riesgo** | Muy alto | Bajo |
| **Coste** | Muy alto | Casi cero |
| **Control** | Total | El que dé el DEX |

> **Regla práctica:** mostrar un enlace o widget hacia un DEX **suele** quedar
> fuera de MiCA (no prestas el servicio tú). Montar tu propio mercado **no**.
> Esto depende de los detalles: **consulta a un abogado** antes.

---

## 4. Comparación de las tres vías

| Vía | Legal | Coste | Cuándo usarla |
| --- | --- | --- | --- |
| **Suscripción + quema** | ✅ Legal | Bajo | **Ya montada** (niveles) |
| **Botón hacia un DEX** | ✅ Normalmente | Casi cero | Para dar compra-venta **ya** |
| **Mercado propio en la app** | ❌ Sin licencia | 150.000 € + CNMV | Solo con licencia y volumen |

---

## 5. Recomendación

1. **La "rueda" es buena, pero no la montes tú.** Añade un **botón "Comprar WTK"**
   que lleve al usuario a un **DEX** (QuickSwap) o use su widget. Así ya hay
   compra-venta, sin licencia.
2. **Cobra la comisión por otro lado**, no como "exchange": por la **suscripción**
   (niveles), la **publicidad**, o una **comisión de creador** que el DEX ya
   soporta (integrator fee). Eso es legal.
3. **Sigue con la quema.** Combínala: la app compra WTK con sus ingresos y los
   quema. No necesitas ser un exchange para que el token suba.
4. **Cuando haya volumen de verdad** y capital (150.000 €), entonces sí: estudia
   la licencia CASP con un abogado. Hasta entonces, **DEX + quema + suscripción**.

> Este documento es orientativo y cita el texto oficial de MiCA, pero **no es
> asesoría legal**. Consulta a un profesional antes de operar con dinero real.

---

## 6. Resumen en una frase

La **rueda** (comprar/vender/comisión) funciona, pero **montarla en tu app exige
licencia MiCA de 150.000 €**. La forma legal y barata de tener lo mismo **hoy**
es un **botón hacia un DEX** + **comisión de creador** + **seguir quemando WTK**
con los ingresos. Cuando tengas volumen y capital, entonces sacas la licencia.
