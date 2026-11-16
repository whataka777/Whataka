'use strict';

/* Compila los contratos de `contracts/` y guarda ABI + bytecode en
 * `contracts/artifacts/`, para no depender de Remix ni de la red.
 *
 * Uso:  npm run compile
 *
 * Usa el compilador de `solc` si está instalado; si no, intenta `npx solc`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const OUT = path.join(CONTRACTS, 'artifacts');
const SOURCES = [
  path.join(CONTRACTS, 'WhaTakaMiningRewards.sol'),
  path.join(CONTRACTS, 'WhaTakaTTC.sol'),
  path.join(CONTRACTS, 'test', 'TestTTC.sol'),
  path.join(CONTRACTS, 'test', 'TestPool.sol'),
  path.join(CONTRACTS, 'test', 'TestUSD.sol'),
];

fs.mkdirSync(OUT, { recursive: true });

let solc;
try {
  solc = require('solc');
} catch {
  solc = null;
}

function compileWithNodeSolc() {
  const input = {
    language: 'Solidity',
    sources: {},
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // 'paris' evita el opcode PUSH0 (Cancun/Shanghai), que algunos nodos y
      // herramientas todavía no aceptan y hace fallar los getters de strings.
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  for (const file of SOURCES) {
    input.sources[path.basename(file)] = { content: fs.readFileSync(file, 'utf8') };
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) {
    throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  }
  return output.contracts;
}

function compileWithCli() {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'solc-'));
  execFileSync('npx', ['--yes', 'solc', '--bin', '--abi', '--optimize', '--evm-version', 'paris', '-o', tmp, ...SOURCES], {
    stdio: 'inherit',
  });
  const contracts = {};
  for (const file of fs.readdirSync(tmp)) {
    const m = file.match(/^(.*)_sol_(.*)\.(abi|bin)$/);
    if (!m) continue;
    const [, source, name, kind] = m;
    contracts[`${source}.sol`] = contracts[`${source}.sol`] || {};
    contracts[`${source}.sol`][name] = contracts[`${source}.sol`][name] || {};
    const value = fs.readFileSync(path.join(tmp, file), 'utf8').trim();
    if (kind === 'abi') contracts[`${source}.sol`][name].abi = JSON.parse(value);
    else contracts[`${source}.sol`][name].evm = { bytecode: { object: value } };
  }
  return contracts;
}

const contracts = solc ? compileWithNodeSolc() : compileWithCli();

let count = 0;
for (const [sourceName, names] of Object.entries(contracts)) {
  for (const [contractName, data] of Object.entries(names)) {
    const artifact = {
      contractName,
      sourceName,
      abi: data.abi,
      bytecode: '0x' + (data.evm.bytecode.object || ''),
    };
    fs.writeFileSync(path.join(OUT, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    console.log(`✓ ${contractName} (${artifact.bytecode.length / 2} bytes)`);
    count += 1;
  }
}

console.log(`\n${count} contratos compilados en contracts/artifacts/`);
