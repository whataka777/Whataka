'use strict';

/* Simulador de ingresos por publicidad y su efecto en el pool del WTK.
 *
 * Responde a: "con N usuarios y publicidad, ¿cuánto ingresa la app y cuánto
 * puedo meter al pool del WTK sin poner dinero de mi bolsillo?".
 *
 * Uso:
 *   node scripts/simulador-ingresos.js
 *   USUARIOS=5000 CPM=1 ANUNCIOS=10 node scripts/simulador-ingresos.js
 */

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

function main() {
  const usuarios = num(process.env.USUARIOS, 1000);
  const cpm = num(process.env.CPM, 1);        // $ por 1.000 impresiones
  const anuncios = num(process.env.ANUNCIOS, 10); // anuncios vistos por usuario al día
  const diasMes = 30;
  const alPool = num(process.env.AL_POOL, 0.3); // fracción del ingreso que va al pool

  const impresionesDia = usuarios * anuncios;
  const impresionesMes = impresionesDia * diasMes;
  const ingresoMes = (impresionesMes / 1000) * cpm;
  const paraPool = ingresoMes * alPool;

  console.log('════════════════════════════════════════════════════════');
  console.log('  SIMULADOR DE INGRESOS POR PUBLICIDAD');
  console.log('════════════════════════════════════════════════════════');
  console.log(`Usuarios activos : ${usuarios.toLocaleString()}`);
  console.log(`Anuncios/usuario : ${anuncios} al día`);
  console.log(`CPM              : ${cpm} $ (varía mucho por país)`);
  console.log(`Al pool          : ${(alPool * 100).toFixed(0)} % del ingreso`);
  console.log('\n── Resultado ──');
  console.log(`Impresiones al mes : ${impresionesMes.toLocaleString()}`);
  console.log(`INGRESO al mes     : ${ingresoMes.toFixed(2)} $`);
  console.log(`Al pool del WTK    : ${paraPool.toFixed(2)} $ al mes`);
  console.log(`En un año          : ${(paraPool * 12).toFixed(2)} $ al pool`);

  console.log('\n── ¿Qué CPM necesitas para distintos escenarios? ──');
  console.log('  (usuarios activos que hacen 10 anuncios/día, para juntar 1.000 $/mes al pool)');
  for (const u of [1000, 5000, 20000, 100000]) {
    const impMes = u * 10 * 30;
    const cpmNecesario = 1000 / (impMes / 1000);
    console.log(`  ${String(u).padStart(7)} usuarios → CPM necesario: ${cpmNecesario.toFixed(3)} $`);
  }

  console.log('\n── Cuánto tarda en llenarse un pool de 1.000 $ ──');
  if (paraPool > 0) {
    console.log(`  Con ${usuarios.toLocaleString()} usuarios: ${(1000 / paraPool).toFixed(1)} meses`);
  } else {
    console.log('  Sin ingresos no se llena nunca.');
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log('LECTURA:');
  console.log('· Con pocos usuarios, la publicidad da poco. Hace falta VOLUMEN.');
  console.log('· Tráfico de Latinoamérica/África tiene CPM bajo (0,2-2 $).');
  console.log('· El "anuncio recompensado" (ver anuncio → ganar WTK) motiva al');
  console.log('  usuario Y financia el pool a la vez.');
}

main();
