# Llamadas que se quedan en «Conectando…»: el servidor TURN

## Qué pasa

Las llamadas van de teléfono a teléfono (P2P), sin pasar por el relé. Para eso
los dos extremos tienen que poder abrirse un camino directo. Con STUN solo se
averigua la dirección pública, y eso basta en muchas redes domésticas.

En redes móviles (y en muchas wifi de operador) el router hace NAT simétrico: el
camino directo no existe. Sin un servidor TURN que haga de puente, la llamada se
queda en «Conectando…» y no hay audio.

Comprobación rápida: `https://whataka.vip/api/ice` debe devolver un servidor con
`turn:` además de los `stun:`. Hoy devuelve solo STUN, así que las llamadas entre
dos redes móviles pueden fallar.

## Cómo se arregla

El relé ya soporta TURN; solo hay que darle las credenciales. Tres variables de
entorno en Render (servicio `whataka-relay`):

| Variable | Ejemplo |
|---|---|
| `ICE_TURN_URL` | `turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443?transport=tcp` |
| `ICE_TURN_USERNAME` | el usuario que da el proveedor |
| `ICE_TURN_CREDENTIAL` | la contraseña que da el proveedor |

Después: **Manual Deploy → Deploy latest commit** y comprobar
`curl -s https://whataka.vip/api/ice`. Si sale `turn:`, ya está.

## Proveedores con plan gratuito

| Proveedor | Gratis | Nota |
|---|---|---|
| Metered (metered.ca) | 500 MB al mes | Lo más rápido de dar de alta; crea un proyecto «TURN» y copia las credenciales |
| Cloudflare Calls | 1 TB al mes | Pide cuenta y generar credenciales por API |
| Twilio Network Traversal | Prueba con saldo | De pago al acabarse la prueba |
| Servidor propio (coturn) | El coste de la máquina | Lo más barato a largo plazo: un VPS de 4 $/mes aguanta muchas llamadas |

El audio sigue cifrado de extremo a extremo (DTLS-SRTP): el TURN reenvía paquetes
que no puede descifrar. Aun así, conviene decírselo a los usuarios en la política
de privacidad: el servidor TURN ve las direcciones IP y el volumen de tráfico.

## Cómo saber si una llamada concreta falló por esto

En la pantalla de llamada hay un botón **Diagnóstico**. Si el fallo es de red, el
texto dirá algo así:

```
conexión: new
hielo: new
candidatos enviados: 0
candidatos recibidos: 0
servidor TURN: no
```

Cero candidatos y `TURN: no` es la firma de «no hay camino posible». Con TURN
configurado, en el mismo caso aparecerían candidatos de tipo `relay` y la llamada
conectaría.

## Lo que ya hace la app desde la versión 82

- Si en 30 segundos no hay conexión, la llamada se cierra con un aviso claro en
  vez de quedarse congelada en «Conectando…».
- Un corte de red de hasta 8 segundos no cuelga: se espera y se reintenta el ICE.
- Un fallo de conexión reintenta el ICE una vez antes de rendirse.
- «En llamada» solo aparece cuando la conexión está establecida de verdad (antes
  bastaba con haber recibido la descripción remota, y con la red bloqueada la
  pantalla decía «En llamada» en silencio).
- El diagnóstico se puede ver durante la llamada y se ofrece al fallar, con botón
  para copiarlo.
