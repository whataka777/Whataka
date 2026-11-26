# Plan de lanzamiento de Whataka en Polygon real

> **Estado: listo para lanzar.** Todo está comprobado contra Polygon mainnet
> (chainId 137) el 2026-11-16. Lo único que falta es **depositar el gas** en la
> wallet de despliegue y ejecutar **un comando**.
>
> | Dato | Valor |
> | --- | --- |
> | **Wallet que recibe el gas** | `0x5dca4aBB6D05A37442c152A7AC9B60a3a3E1AAe6` |
> | Red | Polygon mainnet (chainId **137**), gas en **POL** |
> | Gas necesario | **~2,7 millones de gas ≈ 1,05 POL ≈ $0,08** (con el gas alto de hoy; suele ser menos) |
> | Cuánto depositar | **2 POL** (cubre el lanzamiento y sobra para gas futuro) |
> | Comando del lanzamiento | `node scripts/lanzar.js` (ver paso 2) |

Este documento explica, paso a paso, todo lo necesario para lanzar la app
en **Polygon mainnet (chainId 137)**. Está escrito para que no haya que
improvisar el día del lanzamiento.

Todo el trabajo previo ya está hecho y probado en **Polygon Amoy** (testnet).
Lanzar en real es **repetir los mismos scripts** cambiando el RPC y usando
QuickSwap en lugar del pool de prueba.

---

## 0. Lo que ya está preparado (2026-11-16)

- Contratos **compilados** en `contracts/artifacts/` (solc 0.8.26, EVM `paris`).
- `scripts/lanzar.js` **arreglado y probado**: antes desplegaba un segundo
  contrato de premios con token `0x0` (revertía). Ahora despliega **solo
  `WhaTakaTTC`**, que ya es el ERC-20 *y* el pagador (`claimMiningReward`).
- Validación de **checksum EIP-55** de las direcciones antes de gastar gas.
- La app resuelve **token y red desde el relé** (`tokenWtk()`/`redWtk()`): pasar
  de Amoy a Polygon real solo requiere cambiar `MINING_CONTRACT` en Render, sin
  tocar código.
- **Dry-run real** contra Polygon mainnet: `2.665.534 gas` → `1,05 POL` con el
  gas de hoy (394 gwei), `≈ $0,083`. Con gas normal (~30 gwei) son `~0,08 POL`
  (`≈ $0,006`).
- Claves generadas y guardadas en `.env.mainnet` (ignorado por git):
  - **Desplegador / dueño**: `0x5dca4aBB6D05A37442c152A7AC9B60a3a3E1AAe6`
  - **Oráculo (firma vales)**: `0x6C64E16fAa87fd0BfBDba95eCae0454Bc5ffc3bD`

---


## 1. Resumen: ¿cuánto dinero hace falta?

**Respuesta corta:** el coste real es **pequeño**. La mayor parte del dinero
**no se gasta**: se pone como liquidez y **se puede recuperar**.

| Concepto | Cuánto | ¿Se recupera? |
| --- | --- | --- |
| Gas de despliegue (WTK + pool) | ~0,28 POL ≈ **0,02 $** | No (es la comisión de la red) |
| Liquidez para el mercado | **1.000 – 10.000 USDC** | **Sí, es tuya** |
| Reserva de POL para gas futuro | ~2 POL ≈ **0,16 $** | No (se gasta poco a poco) |
| **Total desembolsado** | **desde ~1.000 USDC** | La mayor parte vuelve |

> Los precios de POL usados aquí son de referencia (POL ≈ 0,08 $ en la fecha
> del cálculo). El gas en Polygon es de los más baratos del mercado.

---

## 2. Lo que YA está hecho (en Amoy)

| Pieza | Dirección en Amoy | Estado |
| --- | --- | --- |
| Token WTK (minable) | `0x57C997a406a0295dEb8A16117969873AAf4B41Fb` | ✅ Desplegado y congelado |
| Pool de ensayo WTK/TUSD | `0x732F63C050a2d78F6fD75e1b0394d2e1B703aA95` | ✅ Liquidez de prueba |
| Config "valiosa" (escasez) | `annualMintCap=0`, `autoMintTopUp=false` | ✅ Aplicada on-chain |

**Decisión de economía:** el creador **no cobra nada**. El valor crece por
**escasez** (oferta congelada) y **utilidad** (la app), no por comisiones.

---

## 3. Conceptos clave (en simple)

**Gas:** la comisión que cobra la red por cada operación. En Polygon es
baratísimo (céntimos).

**Liquidez:** dinero real (USDC) que se pone junto a los WTK en un "pool" para
que la gente pueda comprar y vender. **Es lo que da valor al token.**

**Pool:** la "caja" donde se cambia WTK por USDC y al revés. El precio sale de
dividir el dinero entre los tokens:

```
Precio del WTK = USDC en el pool ÷ WTK en el pool

Ejemplo: 1.000 USDC ÷ 10.000.000 WTK = 0,0001 USDC por WTK
```

**Regla importante:** más USDC en el pool = más vale cada WTK. El precio lo
decides tú al decidir cuánto dinero pones.

---

## 4. Los 5 pasos del lanzamiento real

### Paso 1 — Conseguir POL y USDC en Polygon mainnet

- **POL:** es el gas. Necesitas ~2 POL (menos de 0,20 $).
  Se compra en un exchange (Binance, Kraken…) y se envía a tu wallet.
- **USDC:** es la liquidez. Aquí va el dinero de verdad.
  Se compra igual y se envía a la misma wallet.

**Wallet recomendada:** una wallet nueva, solo para el proyecto. Nunca uses una
wallet con fondos personales.

### Paso 2 — Desplegar el token WTK en Polygon real

**Camino corto (recomendado).** Un solo comando que despliega `WhaTakaTTC`,
congela la oferta y te da las variables de Render. Lee las claves de
`.env.mainnet`:

```bash
npm run lanzar:real
```

Eso equivale a:

```bash
set -a; . ./.env.mainnet; set +a
DRY_RUN=1 node scripts/lanzar.js   # simular primero, no gasta nada
node scripts/lanzar.js             # lanzar de verdad (gasta el gas)
```

El script te avisa si el gas está caro, aborta si supera 5 $ (salvo `FORZAR=1`)
y guarda el resultado en `deploy-mainnet.json`.

**Camino largo (si prefieres el script de despliegue suelto):**

```bash
RPC_URL="https://polygon-bor-rpc.publicnode.com" \
DEPLOYER_KEY="0x<clave de la wallet que paga el gas>" \
REPORT_SIGNER_ADDRESS="0x<dirección del oráculo>" \
CONTRACT=ttc \
INITIAL_SUPPLY=100000000 HALVING_SECONDS=31536000 REWARD_FACTOR=0.001 ANNUAL_MINT_CAP=100000000 \
node scripts/deploy.js
```

Luego se aplica la configuración "valiosa" (congelar la oferta). `lanzar.js` ya
lo hace solo; con `deploy.js` hay que hacerlo aparte:

```bash
RPC_URL="https://polygon-bor-rpc.publicnode.com" \
OWNER_KEY="0x<clave del dueño>" \
WTK_CONTRACT="0x<nueva dirección>" \
node scripts/config-valor.js
```

### Paso 3 — Abrir el pool de liquidez en QuickSwap

QuickSwap es el DEX principal de Polygon (misma matemática que el pool de
prueba). Se hace desde la web de QuickSwap:

1. Ir a **quickswap.exchange** → *Pool* → *Add Liquidity*.
2. Elegir el par **WTK / USDC**.
3. Poner las cantidades (esto fija el precio).
4. Confirmar las transacciones en MetaMask.

> Se necesita **aprobar** primero el gasto de cada token (2 transacciones) y
> luego añadir liquidez (1 transacción).

### Paso 4 — Actualizar el relé (Render)

En el servicio `whataka-relay` → *Environment*:

| Variable | Valor nuevo |
| --- | --- |
| `CHAIN_ID` | `137` |
| `MINING_CONTRACT` | dirección del WTK en mainnet |
| `REPORT_SIGNER_KEY` | la clave del oráculo de mainnet |

Luego un deploy manual (Render no redespliega solo al cambiar variables).

### Paso 5 — Botón "Cobrar" en la app

Añadir en la app un botón que convierta WTK → USDC por el usuario (llamando a
QuickSwap por debajo) y le entregue el USDC en su wallet. Así el usuario cobra
sin saber usar un DEX.

**Nivel A (recomendado al principio):** entrega USDC en la wallet del usuario.
No requiere licencias. Él lo manda a su exchange y saca euros.

**Nivel B (más adelante):** pago directo en euros/dólares por PayPal o
transferencia. Requiere pasarela de pago, verificación de identidad (KYC) y
asesoría legal. Es un negocio aparte.

---

## 5. Tabla de costes según el capital disponible

El precio del WTK lo decides tú con el dinero que pongas. Ejemplos (con
10.000.000 WTK en el pool):

| Capital (USDC) | Precio del WTK | Qué significa |
| --- | --- | --- |
| 1.000 USDC | 0,0001 USDC | Mínimo para que exista mercado |
| 5.000 USDC | 0,0005 USDC | Mercado pequeño pero usable |
| 10.000 USDC | 0,001 USDC | Mercado decente |
| 50.000 USDC | 0,005 USDC | Mercado serio |

**Coste de gas (medido en Polygon real):**

| Operación | Gas | Coste @30 gwei | Coste @275 gwei |
| --- | --- | --- | --- |
| Desplegar WTK | 2.191.122 | 0,066 POL (0,005 $) | 0,60 POL (0,05 $) |
| Abrir pool | ~400.000 | 0,012 POL (0,001 $) | 0,11 POL (0,01 $) |
| **Total gas** | | **~0,08 POL** | **~0,71 POL** |

**Conclusión:** el gas es despreciable (menos de 0,10 $). El único coste real
es la liquidez, y esa **sigue siendo tuya**: puedes retirarla cuando quieras.

---

## 6. Riesgos que debes conocer

**Pérdida por divergencia (impermanent loss):** si el precio del WTK se mueve
mucho, puedes acabar con menos dinero del que pusiste en el pool. Es el riesgo
real de dar liquidez. Con poco movimiento, es pequeño.

**Poca liquidez = precio volátil:** si pones poco dinero, cualquier venta mueve
el precio mucho.

**Pools falsos:** cualquiera puede crear un pool con tu token. Hay que indicar
siempre cuál es el oficial.

**Legal (solo para el Nivel B):** pagar en euros/dólares a usuarios puede exigir
licencia de criptoactivos y KYC/AML según el país. Consúltalo con un abogado
antes de hacerlo.

---

## 7. Lista de comprobación antes de lanzar

- [ ] Tengo POL en la wallet de despliegue (≥2 POL).
- [ ] Tengo USDC para la liquidez (≥1.000 USDC).
- [ ] La wallet es nueva y solo para el proyecto.
- [ ] Tengo la clave del oráculo (`REPORT_SIGNER_KEY`) lista.
- [ ] He probado todo en Amoy (ya hecho).
- [ ] Sé qué precio quiero dar al WTK.
- [ ] Tengo un plan para el botón "Cobrar".

---

## 8. Cómo probar todo ANTES de gastar (Amoy)

Todo el flujo se puede repetir en Amoy, gratis:

```bash
# 1. Desplegar el pool de prueba con el WTK de Amoy
RPC_URL="https://polygon-amoy-bor-rpc.publicnode.com" \
DEPLOYER_KEY="0x<clave del dueño>" \
node scripts/ensayo-pool.js
```

Esto crea un dólar de prueba (TUSD), un pool WTK/TUSD, añade liquidez, fija el
precio y hace una compra de prueba. Sirve para ver la mecánica sin gastar.

---

## 9. Resumen en una frase

> El lanzamiento real cuesta **céntimos de gas**; el dinero de verdad va a
> **liquidez, que sigue siendo tuya**. Con **~1.000 USDC** ya hay mercado, y
> con **~10.000 USDC** el proyecto tiene un mercado serio. El creador no cobra
> nada: el valor crece por escasez y utilidad.
