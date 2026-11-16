# Donaciones en la app (envío y recepción): ¿es legal? ¿Necesita licencia?

Pregunta del usuario: *"¿Y si no se cobra comisión y, en vez de compra-venta, se
coloca envío y recepción de donaciones?"*

Respuesta corta: **esta idea es mucho mejor que la compra-venta.** Bien hecha
(**sin custodia** y con **donaciones de verdad**), **queda fuera de MiCA**. Pero
tiene **tres trampas** que hay que evitar. Abajo está con el texto oficial.

---

## 1. Por qué las donaciones cambian las reglas

MiCA regula **una lista cerrada** de servicios (artículo 3, apartado 1, letra 16):

> *"a) custodia...; b) gestión de una plataforma de negociación; c) canje de
> criptoactivos por fondos; d) canje de criptoactivos por otros criptoactivos;
> e) ejecución de órdenes; f) colocación; g) recepción y transmisión de órdenes;
> h) asesoramiento; i) gestión de carteras; j) **prestación de servicios de
> transferencia de criptoactivos por cuenta de clientes**."*

**"Donación" no está en la lista.** Regalar WTK a alguien no es ninguna de esas
cosas. Ni comprar ni vender: **no hay canje, no hay órdenes, no hay plataforma
de negociación**.

### Y aquí está la palabra mágica: "**por cuenta de clientes**"

Mira cómo se define la transferencia (artículo 3.1.26, texto oficial):

> *"«prestación de servicios de transferencia de criptoactivos»: la prestación de
> servicios de transferencia, **por cuenta de una persona física o jurídica**, de
> criptoactivos de una dirección a otra."*

Y la custodia (artículo 3.1.17):

> *"«custodia y administración de criptoactivos por cuenta de clientes»: la
> **guarda o el control**, por cuenta de clientes, de criptoactivos o de los
> **medios de acceso** a esos criptoactivos, en su caso en forma de **claves
> criptográficas privadas**."*

**La clave es "por cuenta de clientes".** Si el usuario **firma con SU propia
cartera** (MetaMask), es **él** quien transfiere. Tú **no** transfieres por él.
Tú solo **le enseñas la pantalla**. Eso **no** es un servicio de transferencia.

---

## 2. La regla de oro: **sin custodia**

| Tu app... | ¿Es un servicio regulado? |
| --- | --- |
| El usuario conecta **su** MetaMask y firma **él** | ✅ **No** (sin custodia) |
| Tú construyes la transacción, pero **él la firma** | ✅ **No** (sin custodia) |
| Tú guardas las claves privadas de los usuarios | ❌ **Sí** (custodia) |
| Tu servidor mueve las monedas **por** el usuario | ❌ **Sí** (transferencia) |
| La app tiene una "cartera interna" con saldo | ❌ **Sí** (custodia) |

**Regla simple:** si en algún momento **tú tienes las claves o el dinero**, es
custodia → licencia. Si **el usuario siempre firma con su cartera**, no.

---

## 3. Las TRES trampas que hay que evitar

### Trampa 1: la "donación" que en realidad es una compra-venta
Si "donas" 10 USDT y recibes 100 WTK **a un tipo de cambio fijo**, eso **no es una
donación**: es un **canje de criptoactivos por fondos** (artículo 3.1.16.c). La
ley mira **el fondo**, no la etiqueta. **Sería una compra-venta disfrazada** →
licencia.

- ✅ Donación: "manda lo que quieras, sin nada a cambio".
- ❌ Compra-venta disfrazada: "manda 10 USDT y te doy 100 WTK".

### Trampa 2: prometer algo a cambio
Si donas y **recibes** un beneficio (intereses, rentabilidad, "te devuelvo el
doble"), deja de ser donación y puede ser:
- **Interés** → prohibido para CASP (MiCA, art. 40: no se conceden intereses).
- **Inversión** → **mucho peor**: valores (CNMV), como vimos en
  `docs/ACCIONES-Y-QUEMA.md`.

- ✅ Donación: regalo puro, sin contraprestación.
- ❌ "Dona y te doy rentabilidad".

### Trampa 3: la app guarda el dinero
Aunque sean donaciones, si la app **acumula** el WTK/USDT en una cartera propia
antes de enviarlo, eso es **custodia** (artículo 3.1.17). El dinero debe ir
**directo** de la cartera del donante a la del receptor.

- ✅ Directo: donante → receptor, en una transacción.
- ❌ Con escala: donante → app → receptor.

---

## 4. Qué gana y qué NO gana tu token con donaciones

| Donaciones te dan... | Donaciones NO te dan... |
| --- | --- |
| **Uso real** del token (la gente lo mueve) | **Precio** (no hay mercado) |
| **Circulación** (el token se conoce) | **Liquidez** (no hay dónde comprarlo) |
| **Comunidad** (propinas, apoyos) | **Subida de valor** por sí sola |

**Ojo con la expectativa:** las donaciones **no hacen subir el precio**. Un token
sin mercado no tiene precio. Sirven para dar **utilidad** y **circulación**, pero
para el **valor** sigues necesitando un **mercado** (el DEX) o la **quema**.

### La combinación ganadora
```
Donaciones (uso real, sin licencia)
      +
Botón a un DEX (compra-venta legal, sin licencia)
      +
Quema con los ingresos (sube el valor)
      +
Suscripciones/niveles (ingresos)
```

---

## 5. Impuestos (no lo olvides)

Las donaciones **recibidas** suelen contar como **ingreso** en España (IRPF o
Impuesto de Sociedades), valoradas en euros el día de la donación. Y el donante
puede tener su propia obligación fiscal. **Habla con un asesor fiscal.** No es
"dinero gratis" para Hacienda.

---

## 6. Comparación final de las cuatro ideas

| Idea | ¿Licencia MiCA? | ¿Da valor al token? | Veredicto |
| --- | --- | --- | --- |
| Suscripción + quema | ✅ No | ✅ Sí (quema) | **Ya montada** |
| Compra-venta en la app | ❌ Sí (150.000 €) | ✅ Sí (mercado) | Evitar |
| Botón a un DEX | ✅ No | ✅ Sí (mercado) | **Recomendado** |
| **Donaciones (sin custodia)** | ✅ **No** | ⚠️ Uso, no precio | **Buena, como complemento** |

---

## 7. Resumen en una frase

Las **donaciones sin custodia** son **legales y no necesitan licencia** (regalar
no está en la lista de MiCA, y si el usuario firma con su cartera no eres tú quien
transfiere). **Pero** no hacen subir el precio por sí solas: dan **uso** y
**circulación**. Lo perfecto es **combinarlas** con el **botón al DEX** y la
**quema**. Y cuidado con las **tres trampas**: donación con cambio fijo, prometer
algo a cambio, y guardar el dinero.

> Este documento cita el texto oficial de MiCA (Reglamento UE 2023/1114), pero
> **no es asesoría legal**. Consulta a un profesional antes de operar con dinero
> real.
