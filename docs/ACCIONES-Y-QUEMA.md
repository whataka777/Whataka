# ¿Vender acciones y suscripciones con quema de tokens?

Este documento analiza dos ideas para dar valor a Whataka y al WTK:

1. **Vender "acciones"** de Whataka (o sacarla a un mercado de acciones).
2. **Vender una suscripción de pago único** y **quemar** los WTK que se compren.

La respuesta corta: **la idea 2 es excelente. La idea 1 es un delito si se hace
mal.** Abajo está el porqué y cómo hacerlo bien.

---

## Parte 1 — Vender "acciones": cuidado, esto es un terreno muy peligroso

### El problema
Vender "acciones" o "participaciones" de un negocio a cambio de dinero es, casi
siempre, **una oferta de valores** (una inversión financiera). Está **muy
regulada** y hacerlo sin licencia es un **delito**.

En España y la Unión Europea:

| Norma | Qué exige |
| --- | --- |
| **Ley del Mercado de Valores** | Vender participaciones al público exige folleto aprobado por la CNMV |
| **MiCA** (Reglamento europeo, 2024) | Regula la emisión de criptoactivos y su publicidad |
| **Normativa de crowdfunding** | Solo plataformas autorizadas pueden captar fondos del público |

**Vender "acciones de Whataka" por internet, sin licencia, es captación ilegal
de fondos.** Las consecuencias van desde multas hasta prisión.

### Además: vender "acciones" y "tokens" es doble problema
Si además dices que el token **sube de valor por lo que hacen los demás**, eso
puede considerarse **un valor negociable o un esquema de inversión**. Es
justo lo que la ley persigue.

### ⚠️ Señales de alarma (por qué no hacerlo)
- "Compra tokens y ganarás dinero porque subirán" → posible **estafa piramidal**
  o **oferta de valores ilegal**.
- Vender "participaciones del negocio" a desconocidos por internet → ilegal sin
  licencia.
- Prometer rentabilidad → **prohibido** sin ser entidad autorizada.

---

## Cómo hacer algo PARECIDO pero LEGAL

Existen formas reguladas de conseguir dinero de inversores:

| Vía | Qué es | Requisitos |
| --- | --- | --- |
| **Crowdfunding regulado** | Plataformas autorizadas (Crowdcube, Kickstarter para productos) captan dinero por ti | La plataforma cumple la ley; tú solo publicas |
| **Business angel / inversor privado** | Un inversor concreto pone dinero y firma un contrato | Asesoría legal; contrato privado |
| **Subvención / grant** | Dinero no reembolsable para proyectos | Ver `CRECER-CON-POCO-CAPITAL.md` |
| **Préstamo** | Un banco o entidad te presta dinero | Devolverlo con intereses |

**Regla de oro:** si alguien te da dinero esperando **ganar** con ello, hay que
hacerlo **con asesoría legal y por cauces regulados**. Nunca por tu cuenta.

---

## Parte 2 — Suscripción de pago único + quema de tokens: ¡ESTA SÍ!

### La idea (y es muy buena)
El usuario **paga una vez** por una suscripción (por ejemplo, "cuenta Premium de
por vida" por 5 $). Con ese dinero, la app **compra WTK en el mercado y los
quema** (los destruye para siempre).

### Por qué funciona (con números)
Quemar tokens reduce la oferta. Si la oferta baja y la demanda se mantiene, el
**precio sube**. Es lo que hacen proyectos grandes como Binance (BNB) cada
trimestre.

**Ejemplo real con Whataka:**

| Concepto | Valor |
| --- | --- |
| Precio de la suscripción | 5 $ |
| Usuarios que la compran | 1.000 |
| Dinero recaudado | 5.000 $ |
| % que va a comprar y quemar WTK | 50 % → 2.500 $ |
| Con WTK a 0,0001 $ | se queman **25.000.000 WTK** |
| De 100M de tokens | **se destruye el 25 %** |

**Efecto:** la oferta pasa de 100M a 75M de WTK. El mismo dinero compra más
porcentaje del total. **El valor de cada WTK que queda sube.**

### Por qué es legal
- Es una **venta de un servicio** (la suscripción), no una inversión.
- El usuario **no espera ganar dinero**: compra un servicio y lo recibe.
- La quema es una **decisión del proyecto**, no una promesa al usuario.

### El ciclo completo
```
Usuario paga la suscripción (5 $)
        ↓
La app compra WTK en el mercado (QuickSwap)
        ↓
Los WTK se QUEMAN (se destruyen para siempre)
        ↓
La oferta total baja → el WTK vale más
        ↓
Minar y tener WTK vale más → más usuarios
```

### Cómo se implementa (técnico)
1. **Función de quema en el contrato.** ✅ **Ya está hecha**: se añadieron
   `burn(amount)` y `burnFrom(from, amount)` a `WhaTakaTTC.sol`, con su evento
   `TokensBurned`. Verificado en pruebas locales: `totalSupply` baja de forma
   permanente y no se puede quemar más de lo que hay.
2. **La app recauda** el pago (Stripe, PayPal, etc.).
3. **Un proceso automático** compra WTK en el mercado y los quema.
4. **Un registro público** de cuánto se ha quemado (transparencia).

### ⚠️ Lo que hay que cuidar
- **No prometas "subida de precio".** Di solo "quemamos tokens con los ingresos".
  Prometer rentabilidad sí es ilegal.
- **La quema tiene que ser real y verificable** (en la blockchain, que se vea).
- **Pagar impuestos** por los ingresos de las suscripciones.
- Si el WTK ya está **congelado** (oferta máxima), la quema lo hace **deflacionario**:
  cada vez habrá menos. Eso es bueno para el valor.

---

## Comparación de las dos ideas

| | Vender "acciones" | Suscripción + quema |
| --- | --- | --- |
| **Legal** | ❌ Ilegal sin licencia | ✅ Legal |
| **Riesgo** | Multas / prisión | Bajo (fiscalidad) |
| **Necesita licencia** | Sí (CNMV) | No |
| **Da valor al token** | Indirecto | Directo (menos oferta) |
| **Encaja con Whataka** | No | **Sí, perfecto** |
| **Coste de montarlo** | Muy alto (legal) | Bajo (código) |

---

## Recomendación final

1. **Olvida vender "acciones"** por tu cuenta. Si quieres inversores, ve por
   crowdfunding regulado o un inversor privado con abogado.
2. **Implantа la suscripción de pago único con quema de tokens.** Es legal,
   encaja perfecto y da valor real al WTK.
3. **Combínala** con la publicidad y la utilidad del token
   (ver `CRECER-CON-POCO-CAPITAL.md`).
4. **Consulta a un asesor** antes de mover dinero real. Este documento es
   orientativo, no es asesoría legal.

> **La idea de quemar tokens con los ingresos es la mejor que has tenido hasta
> ahora.** Convierte los ingresos de la app en valor para la moneda, sin que tú
> pongas un céntimo de tu bolsillo.
