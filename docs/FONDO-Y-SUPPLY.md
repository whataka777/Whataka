# ¿Se acaban los WTK? ¿Qué pasa cuando se vacía el fondo?

Pregunta del usuario: *"¿es diferente la cantidad de token? Porque después no se
pueden crear más, y el sistema de minado genera más tokens hasta que se acaben
los 100.000.000."*

Respuesta corta: **el minado NO crea tokens nuevos. Reparte los que ya existen.**
Pero tu preocupación es real: el fondo de 90M **sí puede agotarse** si hay
muchísimos usuarios. Abajo está con números leídos de la blockchain.

---

## 1. Dato clave: el minado no "crea" tokens, los reparte

Hay que separar dos cosas:

| | Qué es | Estado real (leído on-chain) |
| --- | --- | --- |
| **Oferta total** | Cuántos WTK existen en el mundo | **100.000.000** |
| **Fondo de minería** | Cuántos quedan por repartir | **90.000.000** |

- Los **100M ya están creados**. Esa es la oferta total y **está congelada**.
- El **tope de emisión es 0** (`annualMintCap = 0`): **nadie** —ni tú— puede crear
  más WTK. Nunca.
- El minado **no acuña**: coge WTK **del fondo** y los entrega al usuario.
  Es como vaciar una hucha, no como fabricar monedas.

> **Entonces, ¿el minado genera tokens nuevos? NO.** Reparte los 90M que ya
> existen. Cuando el fondo llega a cero, el minado se para.

---

## 2. La prueba (leída de la blockchain de Amoy)

```
contrato        : 0x4b0C9d8233DeFa8EcDF28D7a2bAa3EDaa4C8252B
totalSupply     : 100.000.000 WTK      ← la oferta total, congelada
fondo           :  90.000.000 WTK      ← lo que queda por repartir
annualMintCap   : 0                    ← NADIE puede acuñar más, nunca
autoMintTopUp   : false                ← si el fondo se vacía, el minado PARA
rewardFactor    : 0,001 WTK por punto  ← se parte por la mitad cada año
```

**Los 10M que faltan** (100M − 90M) están fuera del fondo: en la liquidez del
pool y en circulación. No desaparecen; ya están repartidos.

---

## 3. ¿Cuánto dura el fondo? (simulación real)

Ejecuta `node scripts/simulador-fondo.js` para verlo tú mismo.

| Usuarios activos | El fondo se agota en |
| --- | --- |
| 100 | nunca (más de 300 años) |
| 1.000 | nunca |
| 10.000 | nunca |
| 50.000 | nunca |
| **100.000** | **~1 año ⚠️** |
| 500.000 | ~2 meses ⚠️ |
| 1.000.000 | ~38 días ⚠️ |

### Por qué el halving salva el fondo con pocos usuarios
Cada año, la recompensa por punto se **parte por la mitad**. Así, aunque haya
gente minando, cada vez se reparte más despacio. Con pocos usuarios, el fondo
dura **siglos**.

### El problema real
Con **muchos** usuarios (100.000 o más), el fondo se agota en **menos de un año**.
Y como `annualMintCap = 0`, **no se puede crear más**: el minado **se detendría**.

---

## 4. Cómo se soluciona (y encaja con todo lo demás)

Aquí está lo bonito: **ya tienes las piezas**. Cuando el fondo se agote, hay
**tres** formas de rellenarlo, y **ninguna crea tokens nuevos**:

### a) `recycleFees` — economía circular (ya en el contrato)
Cualquiera puede devolver WTK al fondo. La app puede hacerlo con parte de sus
**ingresos** (suscripciones, anuncios). Así el fondo se recarga **sin acuñar**.

### b) Los pagos de las suscripciones (niveles)
Recuerda: cada pago **compra y quema** WTK. Pero también puedes destinar una
parte a **rellenar el fondo** en vez de quemarla. Tú decides el reparto.

### c) Subir el precio del WTK
Si el WTK vale más, la misma recompensa (en WTK) vale más en dinero. El minero
no necesita tantos WTK para ganar lo mismo. Menos presión sobre el fondo.

```
Cuando el fondo baja:
   ingresos de la app ──► recycleFees ──► fondo recargado
        (sin crear un solo token nuevo)
```

---

## 5. Las dos "cantidades" que preguntas

Tienes razón en que **hay dos cantidades diferentes**, pero no son las que crees:

| Cantidad | Qué es | ¿Cambia? |
| --- | --- | --- |
| **Oferta total** | WTK que existen | Solo **baja** (cuando se quema). Nunca sube. |
| **Fondo de minería** | WTK por repartir | Baja al minar, **sube** con `recycleFees` |

- La **oferta total** solo puede **bajar** (con las quemas de las suscripciones).
  Eso hace el token **deflacionario**: cada vez hay menos. Bueno para el valor.
- El **fondo** es una bolsa que se vacía al minar y se recarga con ingresos.

> **La cantidad de tokens NO es "diferente por nivel".** Lo que cambia con el
> nivel son las **ventajas**, no cuántos WTK hay. La cantidad de WTK la fija la
> oferta total (100M, y bajando con las quemas).

---

## 6. Resumen en una frase

El minado **no crea** tokens: reparte los 90M que ya existen. La oferta total
(100M) está congelada y solo baja cuando se quema. Si el fondo se agota con
muchos usuarios, se **recarga con los ingresos** (`recycleFees`), sin crear nada
nuevo. Tu economía es **deflacionaria y sostenible**.

---

## 7. Lo que hay que vigilar (recomendación)

1. **Monitorizar el fondo.** Cuando baje de cierto nivel (por ejemplo, 20M),
   activar el relleno con ingresos.
2. **Ajustar el halving** si hace falta (`setHalvingInterval`). Halvings más
   rápidos = fondo dura más.
3. **No subir el `rewardFactor`** sin cuidado: repartiría el fondo más rápido.
4. **Decidir el reparto de cada pago**: ¿cuánto a quemar y cuánto a rellenar el
   fondo? Ahora está al 50% a quema. Se puede repartir (p. ej. 30% quema, 20% fondo).
