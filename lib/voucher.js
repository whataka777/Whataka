'use strict';

/* Vales de minería de WhaTaka.
 *
 * El contrato WhaTakaMiningRewards no se fía de las unidades que le manda el
 * usuario. Este módulo construye el "vale" que el backend firma con su clave
 * secp256k1; el contrato lo verifica con ecrecover antes de pagar.
 *
 * El `voucherDigest` tiene que coincidir EXACTAMENTE con el del contrato
 * (mismo orden de campos y mismos tipos en abi.encode).
 */

const { Wallet, keccak256, toUtf8Bytes, AbiCoder, getBytes, formatUnits } = require('ethers');

const WEIGHTS = { relay: 5n, store: 8n, uptime: 1n, call: 10n, reputation: 3n };
const REWARD_FACTOR = 10n ** 15n;
const MAX_UNITS = 10n ** 9n;

// Orden de campos idéntico a WhaTakaMiningRewards.voucherDigest.
const DIGEST_TYPES = [
  'uint256', // chainId
  'address', // contrato
  'address', // usuario
  'bytes32', // reportHash
  'uint256', // relayUnits
  'uint256', // storeUnits
  'uint256', // uptimeUnits
  'uint256', // callUnits
  'uint256', // reputationUnits
  'uint256', // deadline
];

function reportHashFor(peerId, nonce) {
  return keccak256(toUtf8Bytes(`${peerId}:${nonce}`));
}

function scoreOf(units) {
  return units.relay * WEIGHTS.relay
    + units.store * WEIGHTS.store
    + units.uptime * WEIGHTS.uptime
    + units.call * WEIGHTS.call
    + units.reputation * WEIGHTS.reputation;
}

function rewardUnits(units) {
  return scoreOf(units) * REWARD_FACTOR;
}

function voucherDigest({ chainId, contract, user, reportHash, units, deadline }) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(DIGEST_TYPES, [
      BigInt(chainId),
      contract,
      user,
      reportHash,
      units.relay,
      units.store,
      units.uptime,
      units.call,
      units.reputation,
      BigInt(deadline),
    ]),
  );
}

// Firma tipo MetaMask: sobre el hash con prefijo personal_sign, que es lo que
// valida ecrecover(digest) en el contrato cuando se firma así.
function signVoucher(privateKey, params) {
  const wallet = new Wallet(privateKey);
  const digest = voucherDigest(params);
  return wallet.signMessageSync(getBytes(digest));
}

function signerAddress(privateKey) {
  return new Wallet(privateKey).address;
}

function formatReward(units) {
  return formatUnits(rewardUnits(units), 18);
}

module.exports = {
  WEIGHTS,
  REWARD_FACTOR,
  MAX_UNITS,
  reportHashFor,
  scoreOf,
  rewardUnits,
  voucherDigest,
  signVoucher,
  signerAddress,
  formatReward,
};
