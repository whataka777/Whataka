# Desplegar y validar un token con minería firmada

Lo que se hizo en Whataka el 26 de noviembre de 2026, escrito para poder repetirlo
en otro proyecto sin volver a tropezar con lo mismo.

## Resultado de la operación

| Dato | Valor |
|---|---|
| Contrato | `0x57C997a406a0295dEb8A16117969873AAf4B41Fb` |
| Red | Polygon Amoy (80002) |
| Nombre / símbolo | whataka coin / wtk, 18 decimales |
| Suministro | 100.000.000, todos dentro del contrato como fondo de minería |
| Dueño | `0x8416Ca157c5f24c188F06673eBF37FB902B767c2` (la cartera del usuario) |
| Firmante de vales | `0x2a7F39bDF3dAe21c240536C4d26c05De0087127a` (la clave vive en el servidor) |
| Coste real | 0,21 POL de prueba (2.305.522 de gas a ~92 gwei) |

## La receta, en orden

### 1. Compilar y comprobar que el código lleva lo que debe

```
npm install --save-dev solc@0.8.38
npm run compile
```

Trampa: **solc guarda las cadenas largas desplazadas un bit a la derecha** y las
recoloca con `SHL` al ejecutar, así que buscar `"mi token"` en el bytecode da
«no aparece» aunque esté. Hay que buscar la forma desplazada:

```js
const desplazado = (t) => (BigInt('0x' + Buffer.from(t, 'utf8').toString('hex')) >> 1n)
  .toString(16).padStart(Buffer.byteLength(t) * 2, '0');
```

### 2. Simular el despliegue antes de gastar gas

`eth_call` con el bytecode de creación ejecuta el constructor de verdad y devuelve
el código que quedaría. Si revierte, se ve aquí y no en la cartera.

```js
const datos = fabrica.bytecode + fabrica.interface.encodeDeploy(args).slice(2);
const codigo = await proveedor.call({ from: CUENTA_CON_GAS, data: datos });
// debe empezar por 0x6080
```

### 3. Medir el coste exacto

```js
const gas = await proveedor.estimateGas({ from: CUENTA, data: datos });
const precio = (await proveedor.getFeeData()).maxFeePerGas;
const coste = gas * precio;   // en Whataka: 0,21 POL
```

Regla: mandar siempre **30 % más de gas** del estimado. Con el estimado justo, la
transacción se queda corta y el error que ve el usuario es «out of gas».

### 4. Desplegar

Dos caminos, y el segundo es el que deja al usuario como dueño:

- **Desde el servidor**: `node scripts/deploy.js` con `DEPLOYER_KEY`. El dueño es
  la clave del servidor, y hay que transferir la propiedad después.
- **Desde el móvil**: `whataka.vip/deploy.html`, que usa MetaMask. El dueño es la
  cartera del usuario desde el primer segundo. Es la opción recomendada.

Detalle que ahorra una hora de dudas: la dirección del contrato es
**determinista** a partir de la cuenta y su número de transacción
(`ethers.getCreateAddress({ from, nonce })`). Se puede predecir antes de desplegar,
y sirve para comprobar que el despliegue salió donde debía.

### 5. Verificar el contrato, leyéndolo de la cadena

```
node scripts/verificar-contrato.js <dirección>
REPORT_SIGNER_KEY=0x... node scripts/verificar-contrato.js <dirección>
```

Comprueba nombre, símbolo, decimales, suministro, fondo, dueño, firmante, pausa,
tope y halving, y avisa si la clave del servidor **no** es la que el contrato
acepta.

### 6. Verificar que la firma del oráculo sirve

Firmar un vale y recuperar la dirección:

```js
const firma = voucher.signVoucher(CLAVE, params);
const recuperada = ethers.verifyMessage(ethers.getBytes(voucher.voucherDigest(params)), firma);
// recuperada debe ser igual al reportSigner() del contrato
```

### 7. Verificar el cobro de punta a punta, sin gastar gas

```
REPORT_SIGNER_KEY=0x... node scripts/simular-cobro.js <contrato> [usuario]
```

Hace dos pruebas con `staticCall`, que ejecuta el contrato de verdad pero no
escribe nada:

- el vale firmado por el relé → **debe aceptarlo**;
- un vale firmado por una clave cualquiera → **debe rechazarlo** («Firma del
  oraculo invalida»).

Si las dos salen bien, el circuito completo funciona: el relé mide, firma, y el
contrato paga solo a quien tiene la clave buena.

### 8. Apuntar el servidor y comprobarlo

Variables de entorno: `MINING_CONTRACT` y `REPORT_SIGNER_KEY`. Después, leer el
endpoint de configuración y confirmar que responde `configured: true` con la
dirección nueva. Cambiar variables en Render **no siempre relanza** el servicio:
si no lo hace, basta con un commit para forzar el despliegue.

### 9. Actualizar app, manual y documentos

Dirección en el código, en el manual (capítulos de minería y de futuro) y en los
documentos. Subir la versión de la app para que los móviles suelten la caché vieja.

## Trampas que costaron tiempo

| Trampa | Cómo se detecta | Solución |
|---|---|---|
| Clave del dueño o del firmante perdida | el contrato no acepta cambios y los fondos quedan congelados | guardar la clave en el servidor **antes** de desplegar, y que el dueño sea una cartera con clave conocida |
| Buscar el nombre en el bytecode y no encontrarlo | solc desplaza un bit las cadenas largas | buscar la forma desplazada |
| `getAddress()` distinto del recibo | ethers calcula la dirección con el nonce | usar `receipt.contractAddress` |
| «out of gas» con el gas justo | el estimado no lleva margen | pedir 130 % |
| MetaMask móvil no ve la página | `window.ethereum` no existe fuera de su navegador | abrir la página dentro de MetaMask o usar `metamask.app.link/dapp/<host><ruta>` |
| Explorador sin clave de API | `polygonscan` responde «Invalid API Key» | localizar la transacción con bisección: `eth_getTransactionCount(cuenta, bloque)` |
| Página cacheada en el móvil | el usuario ve la versión anterior | marca de versión visible en el pie y subir la versión del service worker |
| Nombres en mayúsculas mezcladas | «WhaTaka Coin» en el contrato y «whataka» en la marca | decidir el nombre exacto antes de desplegar: es inmutable |

## Prompt para copiar en el próximo proyecto

> Necesito desplegar un token ERC-20 con minería firmada por un oráculo en la red
> de pruebas Polygon Amoy (cadena 80002), y verificarlo de punta a punta antes de
> decir que funciona. Trabaja en español y no me pidas ninguna clave privada.
>
> **Requisitos**
> - Token con nombre y símbolo en minúscula, 18 decimales, suministro inicial
>   acuñado al propio contrato como fondo de minería, halving anual, tope anual de
>   emisión y función `claimMiningReward` que paga contra un vale firmado por el
>   oráculo (`reportSigner`), con tope por cobro y espera entre cobros.
> - El **dueño** del contrato tiene que ser mi cartera de MetaMask, no la del
>   servidor. Si despliegas tú, transfiéreme la propiedad después y demuéstralo.
> - La clave del firmante va en una variable de entorno del servidor. Guárdala en
>   un sitio donde no se pierda y dime dónde está.
>
> **Antes de gastar gas**
> 1. Compila con la misma versión de solc que declare el artefacto y comprueba que
>    el nombre aparece en el bytecode (ojo: solc desplaza un bit las cadenas
>    largas).
> 2. Simula el despliegue con `eth_call` y confirma que devuelve código.
> 3. Estima el gas, calcula el coste en POL y dime la cifra exacta. Pide un 30 %
>    de margen al enviar.
>
> **Después de desplegar, verifica y enséñame las pruebas**
> 1. Lee de la cadena: nombre, símbolo, decimales, suministro, fondo, dueño,
>    firmante, pausa, tope y halving.
> 2. Comprueba que la clave del servidor deriva a la dirección que el contrato
>    acepta como firmante.
> 3. Firma un vale y recupera la dirección con `verifyMessage`: tiene que coincidir
>    con `reportSigner()`.
> 4. Simula un cobro con `staticCall`: el vale del relé debe aceptarse y un vale
>    firmado por otra clave debe rechazarse.
> 5. Configura el servidor y confirma que su endpoint de configuración responde
>    «configurada» con la dirección nueva.
>
> **Forma de trabajar**
> - Nada de «debería funcionar»: cada afirmación con su prueba y su salida real.
> - Si algo no se puede comprobar, dilo claramente en vez de darlo por hecho.
> - Los errores que vea el usuario tienen que estar en español, traducidos y con el
>   texto original disponible para copiar.
> - No me pidas claves privadas ni semillas. Si necesitas gas, dame una dirección
>   pública y la cantidad exacta.
