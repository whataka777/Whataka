// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * WhaTakaMiningRewards
 * --------------------
 * Paga tokens WTK por los reportes de minería de WhaTaka.
 *
 * Modelo de confianza (IMPORTANTE):
 *   El contrato NO se fía de las unidades que le manda quien llama. Si lo
 *   hiciera, cualquiera podría llamar con relayUnits = 1_000_000 y vaciar el
 *   saldo de WTK en una sola transacción. Por eso cada reclamo exige un
 *   "vale" (voucher) firmado fuera de la cadena por la clave `reportSigner`,
 *   que es la del backend que ya verifica los reportes ECDSA en el relé.
 *
 *   El backend calcula la puntuación, firma el vale y el usuario lo presenta
 *   aquí. El contrato recalcula el hash, recupera al firmante con ecrecover y
 *   solo paga si coincide con `reportSigner`.
 *
 * Flujo de una recompensa:
 *   1. La app pide un vale a  POST /api/mining/voucher  (backend).
 *   2. El backend firma `voucherDigest(...)` con su clave secp256k1.
 *   3. La app llama a `claimMiningReward(...)` con ese vale.
 *   4. El contrato verifica la firma, marca el reporte como procesado y
 *      transfiere los WTK al usuario.
 */

/// @notice Interfaz mínima del token WTK (ERC-20).
interface ITTC {
    function transfer(address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

contract WhaTakaMiningRewards {
    /// @notice Token WTK con el que se pagan las recompensas.
    ITTC public immutable ttcToken;

    /// @notice Dueño del contrato (despliega, ajusta pesos y rescata fondos).
    address public owner;

    /// @notice Clave pública del backend autorizado a firmar vales de minería.
    address public reportSigner;

    // Pesos de cada tipo de unidad dentro de la puntuación.
    uint256 public relayWeight = 5;
    uint256 public storeWeight = 8;
    uint256 public uptimeWeight = 1;
    uint256 public callWeight = 10;
    uint256 public reputationWeight = 3;

    /// @notice Factor de escala: score * rewardFactor = cantidad de WTK (en wei).
    uint256 public rewardFactor = 1e15;

    /// @notice Tope por unidad para que la aritmética nunca desborde.
    uint256 public constant MAX_UNITS = 1e9;

    /// @notice Tope de pago por reporte (0 = sin tope). Evita pagar de más por un error del backend.
    uint256 public maxRewardPerReport = 1_000_000e18;

    /// @notice reportHash ya pagado. Protege contra doble gasto (doble reclamo).
    mapping(bytes32 => bool) public processedReports;

    /// @notice Se emite cuando los WTK llegan con éxito al usuario.
    event RewardPaid(address indexed user, uint256 amount, bytes32 reportHash);

    event ReportSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event WeightsUpdated(uint256 relay, uint256 store, uint256 uptime, uint256 call, uint256 reputation);
    event RewardFactorUpdated(uint256 previousFactor, uint256 newFactor);
    event MaxRewardUpdated(uint256 previousMax, uint256 newMax);
    event TokensRescued(address indexed to, uint256 amount);

    /// @dev Semieje del orden de la curva secp256k1, para descartar firmas maleables.
    uint256 private constant _SECP256K1_HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    modifier onlyOwner() {
        require(msg.sender == owner, "No autorizado");
        _;
    }

    /// @param _ttcToken     Dirección del contrato ERC-20 de WTK en esta red.
    /// @param _reportSigner Dirección que corresponde a la clave privada del backend.
    constructor(address _ttcToken, address _reportSigner) {
        require(_ttcToken != address(0), "token cero");
        require(_reportSigner != address(0), "firmante cero");
        ttcToken = ITTC(_ttcToken);
        reportSigner = _reportSigner;
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    // Cálculo de la puntuación
    // ─────────────────────────────────────────────────────────────

    /// @notice Puntuación total: cada unidad multiplicada por su peso.
    function scoreOf(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public view returns (uint256) {
        return relayUnits * relayWeight
            + storeUnits * storeWeight
            + uptimeUnits * uptimeWeight
            + callUnits * callWeight
            + reputationUnits * reputationWeight;
    }

    /// @notice Cantidad de WTK (en wei) que corresponde a esas unidades.
    function rewardFor(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public view returns (uint256) {
        return scoreOf(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits) * rewardFactor;
    }

    /// @notice Hash que el backend firma y el contrato verifica.
    ///         Liga el vale a esta cadena, a este contrato, al usuario concreto
    ///         y a una fecha límite, para que no se pueda reutilizar.
    function voucherDigest(
        bytes32 reportHash,
        address user,
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                user,
                reportHash,
                relayUnits,
                storeUnits,
                uptimeUnits,
                callUnits,
                reputationUnits,
                deadline
            )
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Reclamo de recompensa
    // ─────────────────────────────────────────────────────────────

    /// @notice Reclama la recompensa de un reporte firmado por el backend.
    /// @param reportHash      Identificador único del reporte (evita doble pago).
    /// @param relayUnits      Unidades de relay acumuladas.
    /// @param storeUnits      Unidades de almacenamiento acumuladas.
    /// @param uptimeUnits     Unidades de uptime acumuladas.
    /// @param callUnits       Unidades de llamadas acumuladas.
    /// @param reputationUnits Unidades de reputación acumuladas.
    /// @param deadline        Fecha (epoch, segundos) hasta la que vale la firma.
    /// @param signature       Firma del backend (r || s || v) sobre `voucherDigest`.
    function claimMiningReward(
        bytes32 reportHash,
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "Vale expirado");
        require(!processedReports[reportHash], "Reporte ya procesado");

        // Cota de cordura: evita valores absurdos y cualquier desbordamiento.
        require(
            relayUnits <= MAX_UNITS
                && storeUnits <= MAX_UNITS
                && uptimeUnits <= MAX_UNITS
                && callUnits <= MAX_UNITS
                && reputationUnits <= MAX_UNITS,
            "Unidades fuera de rango"
        );

        // Solo pagamos si el vale lo firmó el backend para ESTE usuario.
        bytes32 digest = voucherDigest(
            reportHash,
            msg.sender,
            relayUnits,
            storeUnits,
            uptimeUnits,
            callUnits,
            reputationUnits,
            deadline
        );
        require(_recover(digest, signature) == reportSigner, "Firma del oraculo invalida");

        uint256 rewardAmount = rewardFor(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits);
        require(rewardAmount > 0, "Recompensa cero");
        if (maxRewardPerReport != 0) {
            require(rewardAmount <= maxRewardPerReport, "Recompensa por encima del tope");
        }

        // Efecto antes de la transferencia (patrón checks-effects-interactions).
        processedReports[reportHash] = true;

        require(ttcToken.transfer(msg.sender, rewardAmount), "Fallo la transferencia WTK");

        emit RewardPaid(msg.sender, rewardAmount, reportHash);
    }

    // ─────────────────────────────────────────────────────────────
    // Administración (solo el dueño)
    // ─────────────────────────────────────────────────────────────

    function setReportSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "firmante cero");
        emit ReportSignerUpdated(reportSigner, newSigner);
        reportSigner = newSigner;
    }

    function setWeights(
        uint256 relay,
        uint256 store,
        uint256 uptime,
        uint256 call,
        uint256 reputation
    ) external onlyOwner {
        relayWeight = relay;
        storeWeight = store;
        uptimeWeight = uptime;
        callWeight = call;
        reputationWeight = reputation;
        emit WeightsUpdated(relay, store, uptime, call, reputation);
    }

    function setRewardFactor(uint256 newFactor) external onlyOwner {
        emit RewardFactorUpdated(rewardFactor, newFactor);
        rewardFactor = newFactor;
    }

    function setMaxRewardPerReport(uint256 newMax) external onlyOwner {
        emit MaxRewardUpdated(maxRewardPerReport, newMax);
        maxRewardPerReport = newMax;
    }

    /// @notice Rescata WTK que hayan quedado atrapados en el contrato.
    function rescueTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "destino cero");
        require(ttcToken.transfer(to, amount), "Fallo la transferencia WTK");
        emit TokensRescued(to, amount);
    }

    /// @notice Saldo de WTK disponible en el contrato para pagar recompensas.
    function rewardPool() external view returns (uint256) {
        return ttcToken.balanceOf(address(this));
    }

    // ─────────────────────────────────────────────────────────────
    // Firma
    // ─────────────────────────────────────────────────────────────

    /// @dev Recupera el firmante y descarta firmas maleables (s alto, v raro).
    ///      Aplica el prefijo EIP-191 ("\x19Ethereum Signed Message:\n32") para
    ///      que la firma sea la estándar de personal_sign / signMessage, la que
    ///      produce ethers.signMessage y MetaMask.
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > _SECP256K1_HALF_N) return address(0);

        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(ethSigned, v, r, s);
    }
}
