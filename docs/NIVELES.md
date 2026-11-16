# Niveles de estatus de WhaTaka

La app vende una **suscripción de pago único** (no una inversión) y, con ese
dinero, **compra WTK en el mercado y los quema**. A cambio, el usuario sube de
nivel y recibe ventajas dentro de la app. Es legal, es adictivo y encaja con el
token.

## La escalera

| Nivel | Puntos | Precio (pago único) | Qué gana el usuario |
| --- | --- | --- | --- |
| 🥉 **Bronce** | 0 | Gratis | Chat cifrado, llamadas P2P, con anuncios |
| 🥈 **Plata** | 500 | 5 $ | Sin anuncios, 1 GB de almacén, temas básicos |
| 🥇 **Oro** | 1500 | 15 $ | Todo lo de Plata, 5 GB, stickers premium, insignia dorada |
| 💎 **Platino** | 5000 | 50 $ | Todo lo de Oro, 20 GB, soporte prioritario, insignia animada |
| 💠 **Diamante** | 15000 | 150 $ | Todo lo de Platino, 100 GB, funciones exclusivas, voto en la app |

## Cómo se gana puntos

Hay **dos caminos**, para que quien no paga también pueda subir:

- **Pago:** cada dólar pagado da **100 puntos** (`PUNTOS_POR_USD`).
  Con un solo pago entras justo en el nivel de su precio.
- **Actividad:** usar la app (minar, días activo) también suma puntos.

## Cómo el pago alimenta el token

De cada pago, una fracción (`FRACCION_QUEMA`, hoy **50 %**) se usa para comprar
WTK y **quemarlos**. Menos oferta, más valor para cada WTK que queda.

```
Usuario paga 15 $ (nivel Oro)
        ↓
50 % (7,50 $) se usa para comprar WTK en el mercado
        ↓
Esos WTK se queman (burn) → la oferta total baja
        ↓
El WTK vale más → minar vale más → más usuarios
```

## Qué hay programado

| Archivo | Qué hace |
| --- | --- |
| `lib/niveles.js` | Motor puro: calcula el nivel, el progreso y la quema. Sin red ni cadena |
| `test/niveles.test.js` | 13 pruebas: umbrales, progreso, quema, coherencia de la escalera |
| `app.js` → `renderNivel()` | Pinta la insignia y la barra de progreso en la pestaña Minería |
| `app.js` → `verNiveles()` | Abre el modal con toda la escalera y las ventajas |
| `index.html` → `#nivel-card` | La tarjeta del nivel en la pestaña Minería |
| `contracts/WhaTakaTTC.sol` → `burn` | La quema real de WTK (ya implementada) |

## Ejemplo real de quema

| Concepto | Valor |
| --- | --- |
| Usuarios que compran Plata (5 $) | 1.000 |
| Dinero recaudado | 5.000 $ |
| % a comprar y quemar (50 %) | 2.500 $ |
| WTK a 0,0001 $ | se queman **25.000.000 WTK** |
| De 100M de tokens | **¡se destruye el 25 %!** 🔥 |

## Reglas legales (importantes)

1. **Nunca prometas que el precio subirá.** Di solo: *"quemamos tokens con los
   ingresos"*. Prometer rentabilidad sí es ilegal.
2. El usuario **compra un servicio**, no invierte. Recibe lo que paga.
3. La quema debe ser **real y verificable** en la blockchain.
4. **Paga impuestos** por los ingresos de las suscripciones.

> Este documento es orientativo, no es asesoría legal. Consulta a un profesional
> antes de mover dinero real.

## Pendiente (próximos pasos)

- Cobrar el pago de verdad (Stripe / PayPal) y, al confirmarlo, llamar a
  `sumarPuntos()` y disparar la compra + quema de WTK.
- Mostrar la insignia del nivel junto al nombre en los chats.
