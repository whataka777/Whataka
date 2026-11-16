# WhaTaka 🥭

Mensajería **P2P cifrada de extremo a extremo** instalable como app (PWA).
El servidor es un **relé tonto**: reenvía sobres cifrados y mantiene la
presencia de los nodos, pero nunca ve el texto en claro.

- App: <https://whataka777.github.io/Whataka/>
- Relé: `https://whataka-relay.onrender.com`

> 📄 ¿Vas a lanzar el proyecto en Polygon real? Lee
> [`docs/PLAN-LANZAMIENTO.md`](docs/PLAN-LANZAMIENTO.md): pasos, costes y
> cuánto dinero hace falta.
>
> 📈 ¿Tienes poco capital? Lee
> [`docs/CRECER-CON-POCO-CAPITAL.md`](docs/CRECER-CON-POCO-CAPITAL.md):
> publicidad, patrocinadores, referidos, subvenciones y utilidad del token.
>
> 🔥 ¿Pensando en vender acciones o en quemar tokens? Lee
> [`docs/ACCIONES-Y-QUEMA.md`](docs/ACCIONES-Y-QUEMA.md): por qué lo primero es
> ilegal y por qué lo segundo (suscripción + quema) es una gran idea.
>
> 👑 ¿Cómo funcionan los niveles (Bronce → Diamante)? Lee
> [`docs/NIVELES.md`](docs/NIVELES.md): la escalera, los precios, las ventajas y
> cómo cada pago quema tokens.

## Qué incluye

| Capa | Archivo | Qué hace |
| --- | --- | --- |
| Interfaz | `index.html` | PWA estilo WhatsApp en tonos morados con pestañas Chats, Novedades, Minería y Ajustes. |
| Lógica | `app.js` | Identidad, cifrado, chat, estados y reportes de minería. |
| Offline | `sw.js` + `manifest.webmanifest` | Instalación en pantalla de inicio y caché de los recursos propios. |
| Relé | `server.js` | HTTP + WebSocket: presencia, intercambio de claves, reenvío de sobres y verificación de firmas. |

## Criptografía

Todo ocurre en el navegador, con WebCrypto:

- **Identidad**: par ECDSA P-256. El Peer ID (`wt1…`) es `base58(SHA-256(clave pública))`.
- **Intercambio de claves**: ECDH P-256 entre pares.
- **Derivación**: HKDF-SHA256 con sal `hash(peerA|peerB)` ordenado.
- **Mensajes**: AES-256-GCM con IV aleatorio por mensaje.
- **Reportes de minería**: firma ECDSA P-256 (IEEE P1363) verificada en el relé con Node `crypto`.

El relé solo transporta `{iv, ct}`. Sin las claves privadas, el contenido es ruido.

## Cómo usarla

1. Abre <https://whataka777.github.io/Whataka/> en el móvil.
2. En el navegador, pulsa **Añadir a la pantalla de inicio** para instalarla.
3. En **Ajustes**, copia tu **Peer ID** y pásaselo a tu contacto.
4. Añade el Peer ID del otro con el botón **➕**. Ambos deben estar en línea la
   primera vez para intercambiar claves públicas.
5. Escribe: el mensaje sale cifrado y solo el destinatario puede abrirlo.

El Peer ID y las conversaciones viven en `localStorage` del dispositivo.

## Desarrollo

```bash
npm install
npm start          # relé en http://localhost:10000
npm test           # 7 pruebas del relé (presencia, claves, cifrado, firmas)
```

Para probar la app contra un relé local:

```
http://localhost:3000/?relay=http://localhost:10000
```

El parámetro `relay` (o `localStorage['whataka.relay']`) permite apuntar a
cualquier nodo sin recompilar. Sin parámetro se usa el relé de Render.

## Despliegue

**GitHub Pages** — sirve la app estática desde la rama `main` (carpeta raíz).

**Render** — `render.yaml` define el servicio `whataka-relay`:

- Build: `npm install`
- Start: `npm start`
- Health check: `/health`
- `autoDeploy: true` (cada push a `main` redespliega el relé)

## API del relé

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado, pares conectados y uptime. |
| `GET` | `/api/peers` | Lista de nodos en línea. |
| `POST` | `/api/mining/report` | Reporte de minería firmado; devuelve `score` y `reward`. |
| `GET` | `/api/mining/:peerId` | Acumulado del nodo. |
| `WS` | `/relay` | Presencia, `getkey` y reenvío de sobres. |

### Protocolo WebSocket

```jsonc
// cliente → relé
{ "t": "hello",  "id": "wt1…", "name": "Ana", "signPub": "…", "agreePub": "…" }
{ "t": "getkey", "id": "wt1…" }
{ "t": "msg",    "to": "wt1…", "iv": "…", "ct": "…" }

// relé → cliente
{ "t": "presence", "peers": [ … ] }
{ "t": "key",      "id": "wt1…", "agreePub": "…" }
{ "t": "msg",      "from": "wt1…", "iv": "…", "ct": "…" }
```

## Alcance y límites

- Los estados se guardan en el dispositivo y se comparten con la red; todavía no
  se difunden por GossipSub real.
- Las llamadas de voz muestran el canal de señalización; el audio WebRTC directo
  está pendiente.
- Las recompensas WTK ya son on-chain: el relé firma un vale y el contrato
  `WhaTakaTTC` paga WTK en Polygon Amoy. El lanzamiento en Polygon real (137)
  está planificado en [`docs/PLAN-LANZAMIENTO.md`](docs/PLAN-LANZAMIENTO.md).

## Licencia

MIT — ver `LICENSE`.
