# Cómo recibir dinero para subsistir con la app

Pregunta: *"¿Cómo puedo recibir algo para subsistir?"*

Esta es **la pregunta correcta**. No se trata de tokens ni de ideas raras: se
trata de que **entre dinero real a tu bolsillo**. Aquí está, en orden, con números
y sin adornos.

---

## 1. La verdad primero: el orden importa

```
1. Tener usuarios que usen la app   ← sin esto, nada de lo demás funciona
2. Cobrarles algo pequeño y justo   ← el primer ingreso
3. Facturar y declarar              ← legal y tranquilo
4. Escalar (más usuarios, más vías) ← cuando ya funciona
```

**El error de casi todos:** buscar cómo cobrar **antes** de tener usuarios. No hay
manera de cobrar a quien no existe. **Lo primero es que la app guste y se use.**

---

## 2. Vía 1 — Suscripción (lo que YA tienes montado) 💶

Tienes los **niveles** (Bronce→Diamante). Esa es tu vía **más directa y legal**.

### Cómo se cobra de verdad (con tu cuenta)
| Herramienta | Comisión | Cuándo usarla |
| --- | --- | --- |
| **Stripe** | **1,5 % + 0,25 €** por pago | La más limpia y profesional |
| **PayPal** | ~2,9 % + 0,35 € (variable) | Si ya tienes cuenta |
| **Transferencia / Bizum** | 0 % | Para los primeros clientes |

**Recomendación:** empieza con **Stripe**. El dinero llega a **tu cuenta del
banco** cada semana. Es automático y legal.

### Cuántos usuarios necesitas para vivir (números reales)

Gastos fijos mínimos de un autónomo:
- **Cuota de autónomo (tarifa plana):** ~**80 €/mes** los 2 primeros años
- **Gestoría:** ~60 €/mes
- **Total gastos fijos:** ~**140 €/mes**

Con una suscripción de **5 €/mes** (cada usuario te deja **~4,7 € netos** tras
Stripe):

| Lo que quieres | Usuarios de 5 €/mes necesarios |
| --- | --- |
| Solo cubrir gastos | **30 usuarios** |
| Cobrar 500 €/mes | 137 usuarios |
| **Cobrar 1.000 €/mes** | **244 usuarios** |
| Cobrar 2.000 €/mes | 458 usuarios |

Con la suscripción de **15 €/mes** (nivel Oro, ~14,5 € netos):

| Lo que quieres | Usuarios de 15 €/mes necesarios |
| --- | --- |
| Cobrar 1.000 €/mes | **79 usuarios** |
| Cobrar 2.000 €/mes | 148 usuarios |

> **Objetivo concreto:** para vivir con **1.000 €/mes** necesitas **~240 usuarios
> de 5 €** o **~79 de 15 €**. Eso es **alcanzable**. Ahí está tu meta.

Ejecuta `node scripts/simulador-subsistencia.js` para verlo tú mismo.

---

## 3. Vía 2 — Publicidad (ingresos sin cobrar al usuario) 📺

Detallada en `docs/CRECER-CON-POCO-CAPITAL.md`. Resumen:

- **Anuncios recompensados**: el usuario ve un anuncio y gana WTK. Tú cobras por
  el anuncio. Todos ganan.
- **Con tráfico hispano** (CPM ~1 $): 1.000 usuarios ≈ 300 $/mes; 5.000 ≈ 1.500 $/mes.
- **Con AdSense** el pago llega a **100 $** mínimo, luego mensual a tu banco.

**Ventaja:** no le cobras nada al usuario. **Inconveniente:** hacen falta **muchos
usuarios** y el CPM hispano es bajo.

---

## 4. Vía 3 — Donaciones voluntarias (de verdad) 🎁

Un botón "**Apoya al creador**". El usuario, **si quiere**, te manda dinero.

- ✅ **Legal** (regalar no está en la lista de MiCA).
- ✅ **Sin custodia** (el dinero va directo a tu cartera).
- ⚠️ **Voluntaria de verdad**: si no dona, usa la app igual.
- ⚠️ **No es un ingreso estable**: unos meses sí, otros no.

Sirve como **complemento**, no como base para subsistir.

---

## 5. Vía 4 — Patrocinadores y referidos 🤝

- **Patrocinador:** un comercio paga por aparecer ("Patrocinado por X"). Un fijo
  al mes, **no depende del CPM**.
- **Referidos:** pagas a quien trae usuarios **activos** (no por reclutar, o es
  pirámide).

**Ventaja:** cero coste por adelantado. **Cuándo:** cuando ya tengas usuarios que
enseñar.

---

## 6. Vía 5 — Subvenciones (dinero "gratis" para proyectos Web3) 🏛️

Polygon Grants, Gitcoin, Giveth, Ethereum Foundation. Dan de **500 $ a 100.000 $**
a proyectos de código abierto y privacidad. **Whataka encaja bien** (mensajería
cifrada, código abierto). Detalle en `docs/CRECER-CON-POCO-CAPITAL.md`.

**Ventaja:** dinero que no devuelves. **Inconveniente:** hay que **solicitarlo**
(trabajo) y competir.

---

## 7. Lo que NO funciona (y por qué)

| Idea | Por qué no |
| --- | --- |
| "Que el token suba y yo venda" | Necesitas mercado, licencia, y no es estable |
| "Que me donen obligatoriamente" | Eso es una cuota: engaño si la llamas donación |
| "Exchange propio con comisión" | Licencia MiCA de 150.000 € |
| "Blanqueo vía WTK" | Delito. Ni se te ocurra. |

---

## 8. Plan concreto para empezar a cobrar (paso a paso)

### Semana 1 — Preparar el cobro
1. Abrir **Stripe** (o PayPal) y conectar tu cuenta bancaria.
2. Poner el botón "**Hazte Plata por 5 €**" en la app, conectado a Stripe.
3. Poner el botón "**Apoya al creador**" (donación voluntaria).

### Semana 2 — Darte de alta
4. **Alta como autónomo** (tarifa plana ~80 €/mes).
5. **Gestoría** (~60 €/mes) para las facturas y los impuestos.
6. Probar **un pago real de 5 €** tú mismo, de principio a fin.

### Mes 1 en adelante — Conseguir los primeros 30
7. **30 usuarios de pago** = cubres gastos.
8. A partir de ahí, **cada usuario más es tu sueldo**.
9. Meta: **240 usuarios de 5 €** = vives con 1.000 €/mes.

---

## 9. La cuenta honesta

```
Ingresos (5 € × 240 usuarios)         1.200 €
− Stripe (1,5 % + 0,25 €)               − 96 €
− Cuota autónomo                         − 80 €
− Gestoría                               − 60 €
− IRPF (estimado)                       − 150 €
────────────────────────────────────────────────
Te quedan                              ~ 814 €/mes
```

**No es rico, pero es real y es tuyo.** Y **crece con cada usuario**. Con 500
usuarios de 5 € ya hablas de **~1.800 €/mes**. Con la mezcla de **niveles +
publicidad + patrocinios**, más.

---

## 10. Resumen en una frase

**Lo primero es tener usuarios, no cobrar.** Después: **suscripción con Stripe**
(la base, legal y directa), **publicidad** (sin cobrar al usuario), **donaciones
voluntarias** y **patrocinios** (complementos). Con **240 usuarios de 5 €** ya
vives. El camino es **lento pero real**: cada usuario de pago te acerca a la
subsistencia.

> Este documento usa datos oficiales (cuota de autónomo del RD-ley 13/2022;
> comisiones de Stripe) pero **no es asesoría fiscal ni laboral**. Habla con un
> **gestor** antes de darte de alta y facturar.
