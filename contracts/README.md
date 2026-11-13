# Minería TTC on-chain (WhaTaka)

Pago de recompensas de minería en tokens TTC reales, reclamables desde MetaMask.

## Dos contratos: elige uno

| Contrato | Cuándo usarlo |
| --- | --- |
| `contracts/WhaTakaMiningRewards.sol` | Ya tienes un token TTC desplegado y solo quieres el sistema de recompensas. |
| `contracts/WhaTakaTTC.sol` | Quieres que WhaTaka controle su propio token, con emisión, halving y tope anual. Es autocontenido (es el ERC-20 **y** el pagador). |

La app y el backend funcionan igual con cualquiera de los dos: lo único que
cambia es la dirección que pones en `MINING_CONTRACT`. Los dos exponen
`claimMiningReward(...)`, `rewardFor(...)`, `scoreOf(...)` y `rewardPool()`.

## Piezas

| Pieza | Fichero | Qué hace |
| --- | --- | --- |
| Contrato (opción A) | `contracts/WhaTakaMiningRewards.sol` | Verifica el vale firmado y transfiere los TTC de un token ya existente. |
| Contrato (opción B) | `contracts/WhaTakaTTC.sol` | ERC-20 propio + halving + tope anual + economía circular, todo en uno. |
| Firma de vales | `lib/voucher.js` | El backend firma el vale con su clave secp256k1. |
| Endpoints | `server.js` | `GET /api/mining/config` y `POST /api/mining/voucher`. |
| App | `app.js` + `index.html` | Conecta MetaMask, pide el vale y llama al contrato. |

## Por qué el contrato exige un vale firmado

`claimMiningReward` **no** se fía de las unidades que envía quien llama. Si lo
hiciera, cualquiera podría llamar con `relayUnits = 1000000000` y vaciar el
saldo de TTC del contrato en una sola transacción.

En su lugar, el backend (el relé de Render, que ya verifica los reportes ECDSA)
calcula la puntuación y firma un vale. El contrato recalcula el hash, recupera
al firmante con `ecrecover` y solo paga si coincide con `reportSigner`. El vale
va atado a la cadena, al contrato, al usuario y a una fecha límite, así que no
se puede reutilizar.

## Puntuación

`score = relay*5 + store*8 + uptime*1 + call*10 + reputation*3`

`reward (en wei de TTC) = score * rewardFactor`, con `rewardFactor = 1e15`.
Ejemplo: score 121 → 121 × 1e15 = 0,121 TTC.

Con `WhaTakaTTC.sol` el importe además baja a la mitad en cada halving (ver
abajo), así que el mismo score paga menos con el tiempo. La app lee el importe
exacto del contrato antes de enviar la transacción.

## Pasos para desplegar

### 1. Clave del firmante (oráculo)

Genera una clave nueva **solo** para firmar vales:

```bash
node -e "const {Wallet}=require('ethers');const w=Wallet.createRandom();console.log('PRIV',w.privateKey);console.log('ADDR',w.address)"
```

Guarda la **ADDR** (la necesitas al desplegar) y la **PRIV** como secreto en
Render (`REPORT_SIGNER_KEY`). No subas la clave privada al repositorio.

### 2. Despliega el contrato

Tienes dos caminos; el primero es más rápido y no depende de Remix.

**Camino A — script incluido (recomendado).** Despliega y te dice los valores
exactos para Render. Necesitas una wallet con gas y el RPC de la red:

```bash
# 1) Clave del firmante (oráculo). Guarda PRIV y ADDR.
node -e "const {Wallet}=require('ethers');const w=Wallet.createRandom();console.log('PRIV',w.privateKey);console.log('ADDR',w.address)"

# 2) Compila y despliega (ejemplo: Polygon Amoy)
npm run compile
RPC_URL="https://rpc-amoy.polygon.technology" \
DEPLOYER_KEY="0x<clave de la wallet que paga el gas>" \
REPORT_SIGNER_ADDRESS="0x<ADDR del paso 1>" \
CONTRACT=ttc \
INITIAL_SUPPLY=1000000 HALVING_SECONDS=31536000 REWARD_FACTOR=0.001 ANNUAL_MINT_CAP=100000000 \
node scripts/deploy.js
```

Para la opción A (`WhaTakaMiningRewards`) usa `CONTRACT=rewards` y añade
`TTC_TOKEN=0x<tu ERC-20>`. El script imprime al final la dirección, el `CHAIN_ID`,
el `MINING_CONTRACT` y un registro JSON del despliegue.

RPC útiles: **BNB Smart Chain** `https://bsc-dataseed.binance.org` (chainId
`56`), **BNB testnet** `https://data-seed-prebsc-1-s1.binance.org:8545` (`97`),
Polygon `https://polygon-bor-rpc.publicnode.com` (`137`), Amoy
`https://polygon-amoy-bor-rpc.publicnode.com` (`80002`). El contrato es agnóstico a la
red: el mismo bytecode sirve en cualquiera de ellas. La app añade la red a
MetaMask sola si aún no la tienes (BNB no viene de fábrica).

**Camino B — Remix.** Pega el fichero elegido, compila con 0.8.20+ y despliega
con *Injected Provider – MetaMask*.

**Opción A — `WhaTakaMiningRewards`** (necesita un token TTC aparte):

| Argumento | Valor |
| --- | --- |
| `_ttcToken` | dirección de tu ERC-20 de TTC en esa red |
| `_reportSigner` | la **ADDR** del paso 1 |

**Opción B — `WhaTakaTTC`** (token propio con halving):

| Argumento | Valor sugerido |
| --- | --- |
| `_reportSigner` | la **ADDR** del paso 1 |
| `_initialSupply` | TTC de arranque del fondo, p. ej. `1000000e18` (1 millón) |
| `_halvingInterval` | segundos por época; `0` = 1 año |
| `_rewardFactor` | TTC por punto en la época 0; `0` = `1e15` (0,001 TTC/punto) |
| `_annualMintCap` | tope de emisión por año, p. ej. `100000000e18` (100 millones) |

### 3. Fondea el fondo de minería

- Opción A: transfiere TTC al contrato; ese es el saldo que se reparte.
- Opción B: el `_initialSupply` ya entra en el fondo al desplegar. Puedes
  añadir más con `mint(amount)` o `fundMiningPool(amount)` (respetan el tope
  anual), o con comisiones vía `recycleFees(amount)` (no acuña).

Comprueba el saldo con `rewardPool()` en Remix.

### 4. Configura Render

En el servicio `whataka-relay` → *Environment*:

| Variable | Valor |
| --- | --- |
| `CHAIN_ID` | `80002` (Amoy) o `137` (Polygon) |
| `MINING_CONTRACT` | dirección del contrato |
| `REPORT_SIGNER_KEY` | la clave privada del paso 1 |

Luego lanza un deploy manual (Render no redespliega solo en este repo):

```bash
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" -d '{"clearCache":"do_not_clear"}' \
  https://api.render.com/v1/services/srv-dbrneam7bikc73b2iu2g/deploys
```

Comprueba: `GET /api/mining/config` debe responder `"configured": true`.

### 5. Úsalo desde la app

Abre https://whataka777.github.io/Whataka/ dentro del navegador de MetaMask,
ve a **Minería**, pulsa **Conectar MetaMask** y después **Firmar y Reclamar TTC
on-chain**. MetaMask pedirá confirmar la transacción.

## Tokenomics de `WhaTakaTTC` (opción B)

### Halving (escasez)

`halvingInterval` define una época. En la época 0 se pagan `rewardFactor` TTC
por punto de score; en la época 1, la mitad; en la 2, un cuarto, y así
sucesivamente: `rewardFactor >> epoch`. Hay un suelo `minRewardFactor` para que
la minería nunca llegue a cero.

- `currentEpoch()` — época actual.
- `rewardFactorAt(epoch)` — factor de una época concreta.
- `nextHalvingTime()` — cuándo ocurre el próximo halving.

Con `halvingInterval = 1 año` el comportamiento es el de Bitcoin: la primera
época paga el 100 %, la segunda el 50 %, etc.

### Tope anual de emisión (antiinflación)

`annualMintCap` es el máximo de TTC acuñables por año natural desde el
despliegue. Es un techo duro: `mintedInYear` lo vigila y la acuñación revierte
con *"Tope anual de emision alcanzado"* si se supera. Consulta `remainingAnnualMint()`.

### Sostenibilidad del fondo

`claimMiningReward` paga primero con el fondo. Si no alcanza y `autoMintTopUp`
está activo, acuña lo que falta **dentro del tope anual**. Así los nodos nunca
se quedan sin cobrar, pero la emisión sigue acotada. Con `autoMintTopUp` en
`false`, un fondo vacío hace revertir el reclamo hasta que alguien lo recargue.

### Economía circular

`recycleFees(amount)` toma comisiones ya existentes (aprueba antes) y las mete
en el fondo. **No acuña nada**, así que reduce la emisión necesaria y la presión
de venta: cuanto más recircula la app, menos TTC nuevos hacen falta.

### Parámetros ajustables (solo el dueño)

`setWeights`, `setHalvingInterval`, `setRewardFactor`, `setMinRewardFactor`,
`setAnnualMintCap`, `setMaxRewardPerReport`, `setAutoMintTopUp`, `setPaused`,
`setReportSigner`, `setMinter`, `transferOwnership`.

## Si cambias los pesos

Los pesos viven en dos sitios y **tienen que coincidir**:

- `lib/voucher.js` → `WEIGHTS` (backend)
- el contrato → `relayWeight`, etc. (o `setWeights` como dueño)

Si no coinciden, el contrato pagará una cantidad distinta a la que muestra la
app. Los tests de `test/contracts/` comprueban que ambos lados calculan igual.

## Pruebas

```bash
npm run compile           # compila los contratos a contracts/artifacts/
npm test                  # relé + vales (12 tests)
npm run test:contract     # WhaTakaMiningRewards sobre una EVM real (ganache)
npm run test:tokenomics   # WhaTakaTTC: halving, tope anual, circular (ganache)
npm run test:all          # las tres suites
```

Los tests de contratos se saltan solos si no está `ganache` instalado.

## Aviso de seguridad

La clave `REPORT_SIGNER_KEY` es un secreto de producción. Quien la tenga puede
firmar vales y drenar el saldo del contrato. Si se filtra, llama a
`setReportSigner` con una dirección nueva y rota la clave.
