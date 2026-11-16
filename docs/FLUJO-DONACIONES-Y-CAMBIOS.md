# El flujo A→B→C con cambios USDT/WTK: ¿hay problema?

Pregunta del usuario: *"Un usuario A le dona USDT a un usuario B. B cambia esos
USDT a WTK y le envía la donación a un usuario C en WTK. C los cambia a USDT y los
retira. ¿No hay problema?"*

Respuesta corta: **sí hay problema, y en tres sitios.** Las **donaciones** (A→B y
B→C) están bien. Pero los **cambios** (USDT→WTK y WTK→USDT) y el **retiro** son
justo las partes reguladas. Y el flujo **completo** se parece mucho a un patrón de
**blanqueo de capitales**. Abajo está el porqué, con la ley en la mano.

---

## 1. El dibujo del flujo, con las partes marcadas

```
A ──USDT──► B ──[CAMBIO]──► WTK ──donación──► C ──[CAMBIO]──► USDT ──[RETIRO]──► dinero
                ▲                                             ▲           ▲
          PROBLEMA 1                                    PROBLEMA 2   PROBLEMA 3
```

- **Donación A→B** y **donación B→C**: ✅ bien (regalar no está en la lista de MiCA).
- **Cambio USDT→WTK** y **cambio WTK→USDT**: ❌ **esto es un servicio regulado**.
- **Retiro a dinero**: ❌ **esto también está regulado**.
- **El conjunto A→...→C**: ⚠️ **parece blanqueo de capitales**.

---

## 2. PROBLEMA 1 y 2: el "cambio" es el servicio regulado

MiCA define el canje con **dos** definiciones exactas (artículo 3.1.19 y 3.1.20):

> *"«**canje de criptoactivos por fondos**»: la celebración de contratos de compra
> o venta de criptoactivos con clientes, a cambio de fondos, **utilizando capital
> propio**."*

> *"«**canje de criptoactivos por otros criptoactivos**»: la celebración de
> contratos de compra o venta de criptoactivos con clientes, a cambio de otros
> criptoactivos, **utilizando capital propio**."*

**Si la app hace el cambio, está haciendo "canje".** Y fíjate en la frase clave:
**"utilizando capital propio"**. Eso significa que **tú** tienes una reserva de
USDT y de WTK, y cambias con el usuario. **Eso es ser un CASP.**

- **Da igual que no cobres comisión.** El servicio está en la lista → licencia.
- **Da igual que lo llames "donación".** La ley mira **lo que haces**: si cambias
  USDT por WTK, es canje.

### ¿Y si el cambio lo hace un DEX?
Si el cambio lo hace un **DEX** (QuickSwap), entonces **no usas tu capital propio**:
el pool del DEX hace el cambio. Tú solo **enlazas**. Eso **normalmente** queda
fuera de MiCA. Pero entonces **la app no cambia nada**: es el usuario, en el DEX.

---

## 3. PROBLEMA 3: el retiro a dinero

El último paso ("C los cambia a USDT y los retira") es **aún más regulado**:

- **Convertir cripto a dinero** = canje de criptoactivos por fondos → CASP.
- **Mover el dinero** = servicio de transferencia → CASP.
- Y todo eso exige **KYC** (identificar al cliente) y **antiblanqueo**.

Si la app permite "retirar a dinero", **necesitas licencia** de forma todavía más
clara.

---

## 4. EL PROBLEMA GORDO: el flujo entero parece blanqueo

Aquí está lo más serio. Fíjate en el **efecto neto**:

```
Entra:  USDT  (de A)
Sale:   USDT  (para C, retirado)
```

**El WTK es solo un paso intermedio.** El dinero entra como USDT y sale como USDT.
Lo único que hace el WTK es **cambiar el rastro**: rompe la cadena entre A y C.
Eso tiene un nombre en el mundo del delito financiero: **estratificación
("layering")**, la segunda fase del **blanqueo de capitales**.

### Por qué es un problema grave
1. **Nadie cambia USDT por USDT** salvo para **ocultar el origen**. Un regulador
   lo ve a la primera.
2. **La ley mira el resultado, no la etiqueta.** "Donación" no tapa que el efecto
   sea "convierto USDT→WTK→USDT para que no se vea de dónde viene".
3. MiCA lo dice expresamente (considerando 16, texto oficial):

   > *"Cualquier legislación que se adopte en el ámbito de los criptoactivos ha de
   > contribuir igualmente al objetivo de **luchar contra el blanqueo de capitales
   > y la financiación del terrorismo**."*

4. Y aunque tú no blanquees, **si tu app lo facilita**, puedes ser responsable de
   **facilitar** el blanqueo (y de no tener los controles que la ley exige).

### La prueba del algodón
Pregúntate: **¿para qué sirve el paso por WTK?**
- Si sirve para **usar** el token (pagar, minar, propinas): ✅ tiene sentido.
- Si sirve para **que no se vea de dónde viene el dinero**: ❌ es blanqueo.

En el flujo que describes, el paso por WTK **no aporta nada** salvo cambiar el
rastro. **Eso es la señal de alarma.**

---

## 5. Además: USDT también está regulado

No lo olvides: **USDT es una "ficha de dinero electrónico" (EMT)** bajo MiCA. No
es una cripto cualquiera. Comerciar con USDT tiene reglas **extra** (el emisor
necesita licencia, y quien lo intercambia también). Es un detalle más que sube el
riesgo.

---

## 6. Comparación: lo que SÍ y lo que NO

| Paso | ¿Legal sin licencia? | Por qué |
| --- | --- | --- |
| Donación A→B (USDT, sin custodia) | ✅ Sí | Regalar no está en la lista |
| **Cambio USDT→WTK en la app** | ❌ **No** | Es "canje" (art. 3.1.19) |
| Donación B→C (WTK, sin custodia) | ✅ Sí | Regalar no está en la lista |
| **Cambio WTK→USDT en la app** | ❌ **No** | Es "canje" (art. 3.1.19) |
| **Retiro a dinero en la app** | ❌ **No** | Canje + transferencia + KYC |
| **El flujo entero (USDT→USDT)** | ❌ **No** | Parece blanqueo (layering) |

---

## 7. La versión legal de tu idea

Tu idea tiene un **núcleo bueno**: que el WTK **circule** entre usuarios. Eso se
consigue **sin los cambios** y **sin el retiro**:

```
✅ A dona USDT a B (sin custodia, fuera de la app)
✅ B compra WTK en un DEX (el DEX hace el cambio, no tú)
✅ B dona WTK a C (sin custodia, dentro de la app)   ← ESTO es lo tuyo
✅ C vende WTK en un DEX (el DEX hace el cambio, no tú)
✅ C retira desde su propia cartera (no desde la app)
```

**La diferencia clave:** los **cambios** y el **retiro** los hace el usuario **en
un DEX**, **fuera** de tu app. Tu app solo hace lo **legal**: las **donaciones**
(envío y recepción de WTK entre usuarios, sin custodia).

Así consigues:
- ✅ El WTK **circula** (uso real, comunidad).
- ✅ **Ningún** paso regulado dentro de tu app.
- ✅ **Sin** apariencia de blanqueo (el usuario hace los cambios a la vista, en un
  DEX público, con su propia cartera).

---

## 8. Resumen en una frase

Las **donaciones** están bien, pero **los cambios y el retiro son los pasos
regulados** (canje → licencia CASP), y **el flujo completo parece blanqueo**
(entra USDT, sale USDT, el WTK solo tapa el rastro). La versión legal es la misma
idea **con los cambios hechos por el usuario en un DEX**, y tu app **solo donando
WTK sin custodia**.

> Este documento cita el texto oficial de MiCA (Reglamento UE 2023/1114), pero
> **no es asesoría legal**. Este flujo concreto (cripto que entra y sale igual,
> pasando por un token intermedio) es exactamente lo que vigilan los reguladores.
> **Consulta a un abogado antes de construirlo.**
